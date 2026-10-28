import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { LegalDocType, LegalDocumentVersion, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { SaveLegalDraftDto, UpdateLegalDraftDto } from './dto/legal-draft.dto.js';
import { UpdateLegalDocumentDto } from './dto/update-legal-document.dto.js';

type Db = PrismaService | Prisma.TransactionClient;
type Named = { id: string; name: string } | null;

// A blank Bangla text means none.
const bangla = (value: string | null | undefined) => (value === undefined ? undefined : value?.trim() ? value : null);

const hasBangla = (contentBn: string | null | undefined) => Boolean(contentBn?.trim());

// The version a new draft or a direct publish takes: one past the live
// copy and past every version saved so far.
export const nextVersion = (liveVersion: number, highestSaved: number) => Math.max(liveVersion, highestSaved) + 1;

// The legal pages (terms, privacy, refunds, FAQ). LegalDocument is the live
// copy the app reads (GET /api/platform/legal/:page); LegalDocumentVersion
// keeps every version published and the one draft being written per page.
// Publishing a draft copies it onto LegalDocument.
@Injectable()
export class LegalDocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  // Each live page with where it stands: its live version, when and by
  // whom it was published, whether a draft is open, and whether it has a
  // Bangla text at all.
  async list() {
    const [docs, published, drafts] = await Promise.all([
      this.prisma.legalDocument.findMany({ orderBy: { type: 'asc' } }),
      this.prisma.legalDocumentVersion.findMany({ where: { status: 'PUBLISHED' }, orderBy: { version: 'desc' }, distinct: ['type'] }),
      this.prisma.legalDocumentVersion.findMany({ where: { status: 'DRAFT' }, orderBy: { updatedAt: 'desc' } }),
    ]);
    const names = await this.names([...docs.map((doc) => doc.updatedBy), ...published.map((row) => row.publishedBy)]);
    return docs.map((doc) => {
      const live = published.find((row) => row.type === doc.type && row.version === doc.version);
      const draft = drafts.find((row) => row.type === doc.type);
      return {
        ...doc,
        liveVersion: doc.version,
        publishedAt: live?.publishedAt ?? doc.updatedAt,
        publishedBy: names(live?.publishedBy ?? doc.updatedBy),
        hasDraft: Boolean(draft),
        draft: draft ? { id: draft.id, version: draft.version, updatedAt: draft.updatedAt } : null,
        bnUpToDate: hasBangla(doc.contentBn),
      };
    });
  }

  async getByType(type: LegalDocType) {
    const doc = await this.prisma.legalDocument.findUnique({ where: { type } });
    if (!doc) {
      throw new NotFoundException('Legal document not found');
    }
    return doc;
  }

  // Every version of one page, newest first.
  async versions(type: LegalDocType) {
    await this.ensureHistory(this.prisma, type);
    const rows = await this.prisma.legalDocumentVersion.findMany({ where: { type }, orderBy: { version: 'desc' } });
    const names = await this.names(rows.flatMap((row) => [row.createdBy, row.publishedBy]));
    return rows.map((row) => this.shown(row, names));
  }

  // Save draft: updates the page's open draft, or starts one numbered one
  // past the live version. There is one draft per page at a time.
  async saveDraft(type: LegalDocType, dto: SaveLegalDraftDto, adminId: string) {
    const draft = await this.prisma.$transaction(async (tx) => {
      await this.ensureHistory(tx, type);
      const open = await tx.legalDocumentVersion.findFirst({ where: { type, status: 'DRAFT' } });
      if (open) {
        return tx.legalDocumentVersion.update({
          where: { id: open.id },
          data: { contentEn: dto.contentEn, ...(dto.contentBn !== undefined && { contentBn: bangla(dto.contentBn) }) },
        });
      }
      const [live, highest] = await Promise.all([tx.legalDocument.findUnique({ where: { type } }), this.highestVersion(tx, type)]);
      return tx.legalDocumentVersion.create({
        data: {
          type,
          version: nextVersion(live?.version ?? 0, highest),
          contentEn: dto.contentEn,
          contentBn: dto.contentBn !== undefined ? bangla(dto.contentBn) : (live?.contentBn ?? null),
          status: 'DRAFT',
          createdBy: adminId,
        },
      });
    });
    return this.shown(draft, await this.names([draft.createdBy]));
  }

  async updateDraft(type: LegalDocType, id: string, dto: UpdateLegalDraftDto) {
    await this.requireDraft(type, id);
    const draft = await this.prisma.legalDocumentVersion.update({
      where: { id },
      data: {
        ...(dto.contentEn !== undefined && { contentEn: dto.contentEn }),
        ...(dto.contentBn !== undefined && { contentBn: bangla(dto.contentBn) }),
      },
    });
    return this.shown(draft, await this.names([draft.createdBy]));
  }

  // Discard: the draft goes; the live page is untouched.
  async discardDraft(type: LegalDocType, id: string) {
    await this.requireDraft(type, id);
    const { count } = await this.prisma.legalDocumentVersion.deleteMany({ where: { id, type, status: 'DRAFT' } });
    if (count === 0) throw new ConflictException('This draft was just published');
    return { success: true };
  }

  // Publish: the draft becomes the live page, as its own version number
  // (one past the live one if the page moved on meanwhile).
  async publish(type: LegalDocType, id: string, adminId: string, ipAddress?: string) {
    const draft = await this.requireDraft(type, id);
    const result = await this.prisma.$transaction(async (tx) => {
      const live = await tx.legalDocument.findUnique({ where: { type } });
      const version = Math.max(draft.version, (live?.version ?? 0) + 1);
      const now = new Date();
      const { count } = await tx.legalDocumentVersion.updateMany({
        where: { id, status: 'DRAFT' },
        data: { status: 'PUBLISHED', publishedAt: now, publishedBy: adminId, version },
      });
      if (count === 0) throw new ConflictException('This draft was just published or discarded');

      const fresh = await tx.legalDocumentVersion.findUniqueOrThrow({ where: { id } });
      const doc = await tx.legalDocument.upsert({
        where: { type },
        create: { type, contentEn: fresh.contentEn, contentBn: fresh.contentBn, version, updatedBy: adminId },
        update: { contentEn: fresh.contentEn, contentBn: fresh.contentBn, version, updatedBy: adminId },
      });
      await tx.auditLog.create({
        data: {
          adminUserId: adminId,
          action: 'LEGAL_DOCUMENT_PUBLISHED',
          entityType: 'LegalDocument',
          entityId: doc.id,
          oldValue: { type, version: live?.version ?? null },
          newValue: { type, version, versionId: id },
          ipAddress,
        },
      });
      return fresh;
    });
    return this.shown(result, await this.names([result.createdBy, result.publishedBy]));
  }

  // The older "edit and save" route: publishes straight away. It writes a
  // PUBLISHED version as well, so the history stays complete; an open
  // draft that held the new number moves up one.
  async update(type: LegalDocType, dto: UpdateLegalDocumentDto, adminId: string, ipAddress?: string) {
    const existing = await this.getByType(type);

    return this.prisma.$transaction(async (tx) => {
      await this.ensureHistory(tx, type);
      const highestPublished = await tx.legalDocumentVersion.aggregate({ where: { type, status: 'PUBLISHED' }, _max: { version: true } });
      const version = nextVersion(existing.version, highestPublished._max.version ?? 0);
      const draft = await tx.legalDocumentVersion.findFirst({ where: { type, status: 'DRAFT' } });
      if (draft && draft.version <= version) {
        await tx.legalDocumentVersion.update({ where: { id: draft.id }, data: { version: version + 1 } });
      }

      const result = await tx.legalDocument.update({
        where: { type },
        data: {
          ...(dto.contentEn !== undefined && { contentEn: dto.contentEn }),
          ...(dto.contentBn !== undefined && { contentBn: dto.contentBn }),
          version,
          updatedBy: adminId,
        },
      });
      await tx.legalDocumentVersion.create({
        data: {
          type,
          version,
          contentEn: result.contentEn,
          contentBn: result.contentBn,
          status: 'PUBLISHED',
          createdBy: adminId,
          publishedBy: adminId,
          publishedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          adminUserId: adminId,
          action: 'LEGAL_DOC_UPDATED',
          entityType: 'LegalDocument',
          entityId: result.id,
          oldValue: { version: existing.version },
          newValue: { version: result.version },
          ipAddress,
        },
      });

      return result;
    });
  }

  // Pages published before versions were kept have no history: the live
  // copy becomes its first PUBLISHED version the first time it is needed.
  private async ensureHistory(db: Db, type: LegalDocType) {
    const any = await db.legalDocumentVersion.findFirst({ where: { type }, select: { id: true } });
    if (any) return;
    const doc = await db.legalDocument.findUnique({ where: { type } });
    if (!doc) return;
    await db.legalDocumentVersion.createMany({
      data: [
        {
          type,
          version: doc.version,
          contentEn: doc.contentEn,
          contentBn: doc.contentBn,
          status: 'PUBLISHED',
          createdBy: doc.updatedBy,
          publishedBy: doc.updatedBy,
          publishedAt: doc.updatedAt,
        },
      ],
      skipDuplicates: true,
    });
  }

  private async highestVersion(db: Db, type: LegalDocType) {
    const { _max } = await db.legalDocumentVersion.aggregate({ where: { type }, _max: { version: true } });
    return _max.version ?? 0;
  }

  private async requireDraft(type: LegalDocType, id: string) {
    const row = await this.prisma.legalDocumentVersion.findFirst({ where: { id, type } });
    if (!row) throw new NotFoundException('Draft not found');
    if (row.status !== 'DRAFT') throw new BadRequestException('Only a draft can be changed, discarded or published');
    return row;
  }

  // Admins' names by id; null for an id with no account (or none at all).
  private async names(ids: (string | null)[]): Promise<(id: string | null) => Named> {
    const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    const users = unique.length > 0 ? await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } }) : [];
    const byId = new Map(users.map((user) => [user.id, user]));
    return (id) => (id ? (byId.get(id) ?? null) : null);
  }

  private shown(row: LegalDocumentVersion, names: (id: string | null) => Named) {
    return {
      id: row.id,
      type: row.type,
      version: row.version,
      status: row.status,
      contentEn: row.contentEn,
      contentBn: row.contentBn,
      createdBy: names(row.createdBy),
      publishedBy: names(row.publishedBy),
      publishedAt: row.publishedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
