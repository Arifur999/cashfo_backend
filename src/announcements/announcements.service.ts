import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Announcement } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateAnnouncementDto } from './dto/create-announcement.dto.js';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto.js';

export type AnnouncementComputedStatus = 'ACTIVE' | 'SCHEDULED' | 'EXPIRED' | 'DISABLED';

function computeStatus(a: { isActive: boolean; startAt: Date; endAt: Date | null }): AnnouncementComputedStatus {
  if (!a.isActive) return 'DISABLED';
  const now = new Date();
  if (now < a.startAt) return 'SCHEDULED';
  if (a.endAt && now > a.endAt) return 'EXPIRED';
  return 'ACTIVE';
}

// The bell row an announcement makes (user-notifications/reminders.ts).
export const bellKey = (id: string) => `announcement:${id}`;
const bellData = (a: Pick<Announcement, 'title' | 'titleBn' | 'body' | 'bodyBn'>) => ({ title: a.title, titleBn: a.titleBn, body: a.body, bodyBn: a.bodyBn });

// What the audit log keeps of one.
const auditView = (a: Announcement): Prisma.InputJsonObject => ({
  title: a.title,
  titleBn: a.titleBn,
  body: a.body,
  bodyBn: a.bodyBn,
  type: a.type,
  targetPlan: a.targetPlan,
  startAt: a.startAt.toISOString(),
  endAt: a.endAt?.toISOString() ?? null,
  isActive: a.isActive,
  linkUrl: a.linkUrl,
});

@Injectable()
export class AnnouncementsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(activeOnly?: boolean) {
    const all = await this.prisma.announcement.findMany({ where: { deletedAt: null }, orderBy: { startAt: 'desc' } });
    const withStatus = all.map((a) => ({ ...a, status: computeStatus(a) }));
    return activeOnly ? withStatus.filter((a) => a.status === 'ACTIVE') : withStatus;
  }

  async active() {
    return this.list(true);
  }

  // What a customer sees: active announcements meant for everyone or for a
  // plan one of their workspaces is on, newest first, without the admin-only
  // fields.
  async forCustomer(planIds: string[]) {
    const now = new Date();
    const rows = await this.prisma.announcement.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        startAt: { lte: now },
        AND: [{ OR: [{ endAt: null }, { endAt: { gt: now } }] }, { OR: [{ targetPlan: null }, { targetPlan: { in: planIds } }] }],
      },
      orderBy: { startAt: 'desc' },
      select: { id: true, title: true, titleBn: true, body: true, bodyBn: true, type: true, startAt: true, endAt: true, linkUrl: true },
    });
    return rows;
  }

  async create(dto: CreateAnnouncementDto, adminId: string, ipAddress?: string) {
    if (dto.endAt && new Date(dto.endAt) <= new Date(dto.startAt)) {
      throw new BadRequestException('endAt must be after startAt');
    }

    return this.prisma.$transaction(async (tx) => {
      const made = await tx.announcement.create({
        data: {
          title: dto.title,
          titleBn: dto.titleBn,
          body: dto.body,
          bodyBn: dto.bodyBn,
          type: dto.type,
          targetPlan: dto.targetPlan,
          startAt: new Date(dto.startAt),
          endAt: dto.endAt ? new Date(dto.endAt) : undefined,
          linkUrl: dto.linkUrl || null,
          createdBy: adminId,
        },
      });
      await tx.auditLog.create({
        data: { adminUserId: adminId, action: 'ANNOUNCEMENT_CREATED', entityType: 'Announcement', entityId: made.id, newValue: auditView(made), ipAddress },
      });
      return made;
    });
  }

  // A change to the words reaches the bells it is already in, read or not.
  async update(id: string, dto: UpdateAnnouncementDto, adminId: string, ipAddress?: string) {
    const existing = await this.requireAnnouncement(id);

    const startAt = dto.startAt !== undefined ? new Date(dto.startAt) : existing.startAt;
    const endAt = dto.endAt !== undefined ? (dto.endAt ? new Date(dto.endAt) : null) : existing.endAt;
    if (endAt && endAt <= startAt) {
      throw new BadRequestException('endAt must be after startAt');
    }

    return this.prisma.$transaction(async (tx) => {
      const after = await tx.announcement.update({
        where: { id },
        data: {
          ...(dto.title !== undefined && { title: dto.title }),
          ...(dto.titleBn !== undefined && { titleBn: dto.titleBn }),
          ...(dto.body !== undefined && { body: dto.body }),
          ...(dto.bodyBn !== undefined && { bodyBn: dto.bodyBn }),
          ...(dto.type !== undefined && { type: dto.type }),
          ...(dto.targetPlan !== undefined && { targetPlan: dto.targetPlan }),
          ...(dto.startAt !== undefined && { startAt }),
          ...(dto.endAt !== undefined && { endAt }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
          ...(dto.linkUrl !== undefined && { linkUrl: dto.linkUrl || null }),
        },
      });
      if (after.title !== existing.title || after.titleBn !== existing.titleBn || after.body !== existing.body || after.bodyBn !== existing.bodyBn) {
        await tx.userNotification.updateMany({ where: { key: bellKey(id) }, data: { data: bellData(after) } });
      }
      await tx.auditLog.create({
        data: {
          adminUserId: adminId,
          action: 'ANNOUNCEMENT_UPDATED',
          entityType: 'Announcement',
          entityId: id,
          oldValue: auditView(existing),
          newValue: auditView(after),
          ipAddress,
        },
      });
      return after;
    });
  }

  // Deleted for everyone: gone from the apps and from every bell at once
  // (the feed leaves it out), kept so the admin can undo.
  async remove(id: string, adminId: string, ipAddress?: string) {
    const existing = await this.requireAnnouncement(id);
    await this.prisma.$transaction([
      this.prisma.announcement.update({ where: { id }, data: { deletedAt: new Date() } }),
      this.prisma.auditLog.create({
        data: { adminUserId: adminId, action: 'ANNOUNCEMENT_DELETED', entityType: 'Announcement', entityId: id, oldValue: auditView(existing), ipAddress },
      }),
    ]);
    return { id };
  }

  // The admin's Undo: back in the apps, and in the bells it was in.
  async restore(id: string, adminId: string, ipAddress?: string) {
    const existing = await this.prisma.announcement.findUnique({ where: { id } });
    if (!existing?.deletedAt) throw new NotFoundException('There is no deleted announcement to bring back');
    const [restored] = await this.prisma.$transaction([
      this.prisma.announcement.update({ where: { id }, data: { deletedAt: null } }),
      this.prisma.auditLog.create({
        data: { adminUserId: adminId, action: 'ANNOUNCEMENT_RESTORED', entityType: 'Announcement', entityId: id, newValue: auditView(existing), ipAddress },
      }),
    ]);
    return { ...restored, status: computeStatus(restored) };
  }

  // The bell rows that show an announcement: none of those deleted, turned
  // off or gone.
  async hiddenFromBell(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const shown = await this.prisma.announcement.findMany({ where: { id: { in: ids }, deletedAt: null, isActive: true }, select: { id: true } });
    const keep = new Set(shown.map((row) => row.id));
    return new Set(ids.filter((id) => !keep.has(id)));
  }

  private async requireAnnouncement(id: string) {
    const announcement = await this.prisma.announcement.findUnique({ where: { id } });
    if (!announcement || announcement.deletedAt) {
      throw new NotFoundException('Announcement not found');
    }
    return announcement;
  }
}
