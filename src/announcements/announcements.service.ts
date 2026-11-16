import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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

// What the audit log keeps of an announcement.
export function auditView(a: { title: string; type: string; targetPlan: string | null; startAt: Date; endAt: Date | null; isActive: boolean }) {
  return {
    title: a.title,
    type: a.type,
    targetPlan: a.targetPlan,
    startAt: a.startAt.toISOString(),
    endAt: a.endAt?.toISOString() ?? null,
    isActive: a.isActive,
  };
}

@Injectable()
export class AnnouncementsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(activeOnly?: boolean) {
    const all = await this.prisma.announcement.findMany({ orderBy: { startAt: 'desc' } });
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
        startAt: { lte: now },
        AND: [{ OR: [{ endAt: null }, { endAt: { gt: now } }] }, { OR: [{ targetPlan: null }, { targetPlan: { in: planIds } }] }],
      },
      orderBy: { startAt: 'desc' },
      select: { id: true, title: true, titleBn: true, body: true, bodyBn: true, type: true, startAt: true, endAt: true, linkUrl: true },
    });
    return rows;
  }

  // Every admin write is in the audit log: what went out, by whom, from where.
  async create(dto: CreateAnnouncementDto, adminId: string, ipAddress?: string) {
    if (dto.endAt && new Date(dto.endAt) <= new Date(dto.startAt)) {
      throw new BadRequestException('endAt must be after startAt');
    }

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.announcement.create({
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
        data: {
          adminUserId: adminId,
          action: 'ANNOUNCEMENT_CREATED',
          entityType: 'Announcement',
          entityId: created.id,
          newValue: auditView(created),
          ipAddress,
        },
      });
      return created;
    });
  }

  async update(id: string, dto: UpdateAnnouncementDto, adminId: string, ipAddress?: string) {
    const existing = await this.requireAnnouncement(id);

    const startAt = dto.startAt !== undefined ? new Date(dto.startAt) : existing.startAt;
    const endAt = dto.endAt !== undefined ? (dto.endAt ? new Date(dto.endAt) : null) : existing.endAt;
    if (endAt && endAt <= startAt) {
      throw new BadRequestException('endAt must be after startAt');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.announcement.update({
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
      await tx.auditLog.create({
        data: {
          adminUserId: adminId,
          action: 'ANNOUNCEMENT_UPDATED',
          entityType: 'Announcement',
          entityId: id,
          oldValue: auditView(existing),
          newValue: auditView(updated),
          ipAddress,
        },
      });
      return updated;
    });
  }

  // Gone from the apps at once; the audit log keeps what it said.
  async remove(id: string, adminId: string, ipAddress?: string) {
    const existing = await this.requireAnnouncement(id);
    await this.prisma.announcement.delete({ where: { id } });
    await this.prisma.auditLog.create({
      data: {
        adminUserId: adminId,
        action: 'ANNOUNCEMENT_DELETED',
        entityType: 'Announcement',
        entityId: id,
        oldValue: { title: existing.title, type: existing.type, startAt: existing.startAt.toISOString(), isActive: existing.isActive },
        ipAddress,
      },
    });
    return { id };
  }

  private async requireAnnouncement(id: string) {
    const announcement = await this.prisma.announcement.findUnique({ where: { id } });
    if (!announcement) {
      throw new NotFoundException('Announcement not found');
    }
    return announcement;
  }
}
