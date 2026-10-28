import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateNotificationTemplateDto } from './dto/create-notification-template.dto.js';
import { UpdateNotificationTemplateDto } from './dto/update-notification-template.dto.js';

@Injectable()
export class NotificationTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.notificationTemplate.findMany({ orderBy: { key: 'asc' } });
  }

  // A template made in the admin panel (one for a campaign, say). Keys are
  // unique: the code and campaigns find a template by its key.
  async create(dto: CreateNotificationTemplateDto, adminId: string, ipAddress?: string) {
    const taken = await this.prisma.notificationTemplate.findUnique({ where: { key: dto.key }, select: { id: true } });
    if (taken) {
      throw new ConflictException('A template with this key already exists');
    }

    const result = await this.prisma.notificationTemplate.create({
      data: {
        key: dto.key,
        channel: dto.channel,
        subjectEn: dto.subjectEn?.trim() || null,
        subjectBn: dto.subjectBn?.trim() || null,
        bodyEn: dto.bodyEn,
        bodyBn: dto.bodyBn,
        variables: dto.variables ?? [],
        isActive: dto.isActive ?? true,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        adminUserId: adminId,
        action: 'NOTIFICATION_TEMPLATE_CREATED',
        entityType: 'NotificationTemplate',
        entityId: result.id,
        newValue: { key: result.key, channel: result.channel, isActive: result.isActive },
        ipAddress,
      },
    });

    return result;
  }

  async update(id: string, dto: UpdateNotificationTemplateDto, adminId: string, ipAddress?: string) {
    const existing = await this.prisma.notificationTemplate.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Notification template not found');
    }

    const result = await this.prisma.notificationTemplate.update({
      where: { id },
      data: {
        ...(dto.subjectEn !== undefined && { subjectEn: dto.subjectEn }),
        ...(dto.subjectBn !== undefined && { subjectBn: dto.subjectBn }),
        ...(dto.bodyEn !== undefined && { bodyEn: dto.bodyEn }),
        ...(dto.bodyBn !== undefined && { bodyBn: dto.bodyBn }),
        ...(dto.variables !== undefined && { variables: dto.variables }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        adminUserId: adminId,
        action: 'NOTIFICATION_TEMPLATE_UPDATED',
        entityType: 'NotificationTemplate',
        entityId: id,
        oldValue: { subjectEn: existing.subjectEn, bodyEn: existing.bodyEn, isActive: existing.isActive },
        newValue: { subjectEn: result.subjectEn, bodyEn: result.bodyEn, isActive: result.isActive },
        ipAddress,
      },
    });

    return result;
  }
}
