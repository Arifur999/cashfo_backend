import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpdateNotificationTemplateDto } from './dto/update-notification-template.dto.js';

@Injectable()
export class NotificationTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.notificationTemplate.findMany({ orderBy: { key: 'asc' } });
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
      },
    });

    await this.prisma.auditLog.create({
      data: {
        adminUserId: adminId,
        action: 'NOTIFICATION_TEMPLATE_UPDATED',
        entityType: 'NotificationTemplate',
        entityId: id,
        oldValue: { subjectEn: existing.subjectEn, bodyEn: existing.bodyEn },
        newValue: { subjectEn: result.subjectEn, bodyEn: result.bodyEn },
        ipAddress,
      },
    });

    return result;
  }
}
