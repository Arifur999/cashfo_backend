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

  async create(dto: CreateAnnouncementDto, adminId: string) {
    if (dto.endAt && new Date(dto.endAt) <= new Date(dto.startAt)) {
      throw new BadRequestException('endAt must be after startAt');
    }

    return this.prisma.announcement.create({
      data: {
        title: dto.title,
        titleBn: dto.titleBn,
        body: dto.body,
        bodyBn: dto.bodyBn,
        type: dto.type,
        targetPlan: dto.targetPlan,
        startAt: new Date(dto.startAt),
        endAt: dto.endAt ? new Date(dto.endAt) : undefined,
        createdBy: adminId,
      },
    });
  }

  async update(id: string, dto: UpdateAnnouncementDto) {
    const existing = await this.requireAnnouncement(id);

    const startAt = dto.startAt !== undefined ? new Date(dto.startAt) : existing.startAt;
    const endAt = dto.endAt !== undefined ? (dto.endAt ? new Date(dto.endAt) : null) : existing.endAt;
    if (endAt && endAt <= startAt) {
      throw new BadRequestException('endAt must be after startAt');
    }

    return this.prisma.announcement.update({
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
      },
    });
  }

  private async requireAnnouncement(id: string) {
    const announcement = await this.prisma.announcement.findUnique({ where: { id } });
    if (!announcement) {
      throw new NotFoundException('Announcement not found');
    }
    return announcement;
  }
}
