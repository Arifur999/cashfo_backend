import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateSavedReplyDto, UpdateSavedReplyDto } from './dto/saved-reply.dto.js';

type SavedReplyRow = { id: string; title: string; bodyEn: string; bodyBn: string | null; createdBy: string; createdAt: Date; updatedAt: Date };

// A blank Bangla body means "none": the reply box falls back to English.
const bangla = (value: string | null | undefined) => (value === undefined ? undefined : value ? value : null);

// The support team's canned answers (Ticket > Saved replies). Shared by the
// whole team; any admin reads them, SUPER and SUPPORT admins keep them.
@Injectable()
export class SavedRepliesService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const rows = await this.prisma.savedReply.findMany({ orderBy: [{ title: 'asc' }, { createdAt: 'asc' }] });
    return this.withAuthors(rows);
  }

  async create(dto: CreateSavedReplyDto, adminId: string, ipAddress?: string) {
    const row = await this.prisma.savedReply.create({ data: { title: dto.title, bodyEn: dto.bodyEn, bodyBn: bangla(dto.bodyBn) ?? null, createdBy: adminId } });
    await this.audit(adminId, 'SAVED_REPLY_CREATED', row.id, null, { title: row.title }, ipAddress);
    const [shown] = await this.withAuthors([row]);
    return shown;
  }

  async update(id: string, dto: UpdateSavedReplyDto, adminId: string, ipAddress?: string) {
    const existing = await this.requireReply(id);
    const row = await this.prisma.savedReply.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.bodyEn !== undefined && { bodyEn: dto.bodyEn }),
        ...(dto.bodyBn !== undefined && { bodyBn: bangla(dto.bodyBn) }),
      },
    });
    await this.audit(adminId, 'SAVED_REPLY_UPDATED', id, { title: existing.title }, { title: row.title }, ipAddress);
    const [shown] = await this.withAuthors([row]);
    return shown;
  }

  async remove(id: string, adminId: string, ipAddress?: string) {
    const existing = await this.requireReply(id);
    await this.prisma.savedReply.delete({ where: { id } });
    await this.audit(adminId, 'SAVED_REPLY_DELETED', id, { title: existing.title }, null, ipAddress);
    return { success: true };
  }

  private async requireReply(id: string) {
    const row = await this.prisma.savedReply.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Saved reply not found');
    return row;
  }

  // Who wrote each one; null once that admin's account is gone.
  private async withAuthors(rows: SavedReplyRow[]) {
    const ids = [...new Set(rows.map((row) => row.createdBy))];
    const authors = ids.length > 0 ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
    const byId = new Map(authors.map((author) => [author.id, author]));
    return rows.map(({ createdBy, ...row }) => ({ ...row, createdBy: byId.get(createdBy) ?? null }));
  }

  private async audit(adminId: string, action: string, entityId: string, oldValue: object | null, newValue: object | null, ipAddress?: string) {
    await this.prisma.auditLog.create({
      data: {
        adminUserId: adminId,
        action,
        entityType: 'SavedReply',
        entityId,
        ...(oldValue && { oldValue }),
        ...(newValue && { newValue }),
        ipAddress,
      },
    });
  }
}
