import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { LegalDocumentsService, nextVersion } from './legal-documents.service.js';

type Row = Record<string, unknown>;
type Where = { id?: string; type?: string; status?: string };

const matches = (row: Row, where: Where = {}) => Object.entries(where).every(([key, value]) => row[key] === value);

// Just the slice of Prisma the service uses, over two in-memory tables.
const fakePrisma = () => {
  const docs: Row[] = [
    {
      id: 'doc-privacy',
      type: 'PRIVACY_POLICY',
      contentEn: 'v3 text',
      contentBn: 'v3 বাংলা',
      version: 3,
      updatedAt: new Date('2026-09-01'),
      updatedBy: 'admin-sajid',
    },
  ];
  const versions: Row[] = [];
  let n = 0;
  const stamp = (row: Row) => ({
    id: `ver-${++n}`,
    status: 'DRAFT',
    contentBn: null,
    createdBy: null,
    publishedBy: null,
    publishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...row,
  });
  const prisma = {
    $transaction: vi.fn(async (run: (tx: unknown) => unknown) => run(prisma)),
    legalDocument: {
      findMany: vi.fn(async () => docs.map((doc) => ({ ...doc }))),
      findUnique: vi.fn(async ({ where }: { where: Where }) => {
        const doc = docs.find((d) => matches(d, where));
        return doc ? { ...doc } : null;
      }),
      update: vi.fn(async ({ where, data }: { where: Where; data: Row }) =>
        Object.assign(
          docs.find((doc) => matches(doc, where))!,
          data,
        ),
      ),
      upsert: vi.fn(async ({ where, create, update }: { where: Where; create: Row; update: Row }) => {
        const doc = docs.find((d) => matches(d, where));
        if (doc) return Object.assign(doc, update);
        docs.push({ id: `doc-${create.type as string}`, ...create });
        return docs[docs.length - 1];
      }),
    },
    legalDocumentVersion: {
      findMany: vi.fn(async ({ where }: { where: Where }) =>
        versions.filter((v) => matches(v, where)).sort((a, b) => (b.version as number) - (a.version as number)),
      ),
      findFirst: vi.fn(async ({ where }: { where: Where }) => versions.find((v) => matches(v, where)) ?? null),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: Where }) => versions.find((v) => matches(v, where))!),
      create: vi.fn(async ({ data }: { data: Row }) => {
        if (versions.some((v) => v.type === data.type && v.version === data.version)) throw new Error('P2002');
        versions.push(stamp(data));
        return versions[versions.length - 1];
      }),
      createMany: vi.fn(async ({ data }: { data: Row[] }) => {
        versions.push(...data.map(stamp));
        return { count: data.length };
      }),
      update: vi.fn(async ({ where, data }: { where: Where; data: Row }) =>
        Object.assign(
          versions.find((v) => matches(v, where))!,
          data,
        ),
      ),
      updateMany: vi.fn(async ({ where, data }: { where: Where; data: Row }) => {
        const hit = versions.filter((v) => matches(v, where));
        hit.forEach((v) => Object.assign(v, data));
        return { count: hit.length };
      }),
      deleteMany: vi.fn(async ({ where }: { where: Where }) => {
        const before = versions.length;
        versions.splice(0, versions.length, ...versions.filter((v) => !matches(v, where)));
        return { count: before - versions.length };
      }),
      aggregate: vi.fn(async ({ where }: { where: Where }) => {
        const found = versions.filter((v) => matches(v, where)).map((v) => v.version as number);
        return { _max: { version: found.length > 0 ? Math.max(...found) : null } };
      }),
    },
    user: { findMany: vi.fn(async () => [{ id: 'admin-sajid', name: 'Sajid Hasan' }]) },
    auditLog: { create: vi.fn(async () => ({})) },
  };
  return { prisma, docs, versions };
};

const setup = () => {
  const fake = fakePrisma();
  return { ...fake, service: new LegalDocumentsService(fake.prisma as never) };
};

describe('LegalDocumentsService versions', () => {
  it('back-fills the live copy as the first published version, newest first', async () => {
    const { service } = setup();
    const rows = await service.versions('PRIVACY_POLICY');
    expect(rows).toEqual([
      expect.objectContaining({ version: 3, status: 'PUBLISHED', contentEn: 'v3 text', publishedBy: { id: 'admin-sajid', name: 'Sajid Hasan' } }),
    ]);
    // Only once.
    expect(await service.versions('PRIVACY_POLICY')).toHaveLength(1);
  });

  it('keeps one draft per page, numbered one past the live version, starting from the live Bangla', async () => {
    const { service, versions } = setup();
    const draft = await service.saveDraft('PRIVACY_POLICY', { contentEn: 'v4 text' }, 'admin-sajid');
    expect(draft).toMatchObject({
      version: 4,
      status: 'DRAFT',
      contentEn: 'v4 text',
      contentBn: 'v3 বাংলা',
      createdBy: { id: 'admin-sajid', name: 'Sajid Hasan' },
    });

    const again = await service.saveDraft('PRIVACY_POLICY', { contentEn: 'v4 text, edited', contentBn: null }, 'admin-sajid');
    expect(again).toMatchObject({ id: draft.id, version: 4, contentEn: 'v4 text, edited', contentBn: null });
    expect(versions.filter((v) => v.status === 'DRAFT')).toHaveLength(1);
  });

  it('publishes a draft onto the live page and audits it', async () => {
    const { service, docs, prisma } = setup();
    const draft = await service.saveDraft('PRIVACY_POLICY', { contentEn: 'v4 text', contentBn: 'v4 বাংলা' }, 'admin-sajid');
    const published = await service.publish('PRIVACY_POLICY', draft.id, 'admin-sajid', '1.2.3.4');

    expect(published).toMatchObject({ version: 4, status: 'PUBLISHED', publishedBy: { id: 'admin-sajid', name: 'Sajid Hasan' } });
    expect(docs[0]).toMatchObject({ contentEn: 'v4 text', contentBn: 'v4 বাংলা', version: 4, updatedBy: 'admin-sajid' });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'LEGAL_DOCUMENT_PUBLISHED', entityId: 'doc-privacy', oldValue: { type: 'PRIVACY_POLICY', version: 3 } }),
    });
    await expect(service.publish('PRIVACY_POLICY', draft.id, 'admin-sajid')).rejects.toBeInstanceOf(BadRequestException);

    const list = await service.list();
    expect(list[0]).toMatchObject({ liveVersion: 4, hasDraft: false, draft: null, bnUpToDate: true, publishedBy: { id: 'admin-sajid', name: 'Sajid Hasan' } });
  });

  it('the direct edit publishes a version too, and moves an open draft past it', async () => {
    const { service, versions } = setup();
    const draft = await service.saveDraft('PRIVACY_POLICY', { contentEn: 'draft' }, 'admin-sajid');
    await service.update('PRIVACY_POLICY', { contentEn: 'quick fix' }, 'admin-sajid');

    expect(versions.find((v) => v.contentEn === 'quick fix')).toMatchObject({ version: 4, status: 'PUBLISHED' });
    expect(versions.find((v) => v.id === draft.id)).toMatchObject({ version: 5, status: 'DRAFT' });
  });

  it('discards a draft, leaving the live page alone', async () => {
    const { service, docs, versions } = setup();
    const draft = await service.saveDraft('PRIVACY_POLICY', { contentEn: 'draft' }, 'admin-sajid');
    expect(await service.discardDraft('PRIVACY_POLICY', draft.id)).toEqual({ success: true });
    expect(versions.some((v) => v.status === 'DRAFT')).toBe(false);
    expect(docs[0].version).toBe(3);
  });

  it('nextVersion is one past both the live copy and every saved version', () => {
    expect(nextVersion(3, 3)).toBe(4);
    expect(nextVersion(0, 0)).toBe(1);
    expect(nextVersion(3, 5)).toBe(6);
  });
});
