import { BadRequestException, Injectable, NotFoundException, NotImplementedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateCampaignDto } from './dto/create-campaign.dto.js';

const SENDABLE_STATUSES = ['DRAFT', 'SCHEDULED'];

@Injectable()
export class NotificationCampaignsService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.bulkNotificationCampaign.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async create(dto: CreateCampaignDto, adminId: string) {
    const template = await this.prisma.notificationTemplate.findUnique({ where: { key: dto.templateKey } });
    if (!template) {
      throw new NotFoundException('Notification template not found');
    }

    return this.prisma.bulkNotificationCampaign.create({
      data: {
        title: dto.title,
        templateKey: dto.templateKey,
        targetFilter: dto.targetFilter as unknown as Prisma.InputJsonValue,
        channel: dto.channel,
        status: dto.scheduledFor ? 'SCHEDULED' : 'DRAFT',
        scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : null,
        createdBy: adminId,
      },
    });
  }

  // There is no real email/SMS/push provider (e.g. SendGrid, Twilio, a local
  // SMS gateway) wired up anywhere in this app. This used to fabricate a
  // 95-99% random success rate and write matching NotificationLog rows as if
  // a real send had happened -- clicking "Send Now" would silently lie to
  // the admin. Until a real provider is integrated, this honestly refuses.
  async send(id: string): Promise<never> {
    const campaign = await this.requireCampaign(id);
    if (!SENDABLE_STATUSES.includes(campaign.status)) {
      throw new BadRequestException('Only DRAFT or SCHEDULED campaigns can be sent');
    }
    throw new NotImplementedException(
      'Real notification delivery is not wired up yet -- no email/SMS/push provider is integrated in this app.',
    );
  }

  async cancel(id: string, adminId: string, ipAddress?: string) {
    const campaign = await this.requireCampaign(id);
    if (!SENDABLE_STATUSES.includes(campaign.status)) {
      throw new BadRequestException('Only DRAFT or SCHEDULED campaigns can be cancelled');
    }

    const result = await this.prisma.bulkNotificationCampaign.update({ where: { id }, data: { status: 'CANCELLED' } });

    await this.prisma.auditLog.create({
      data: {
        adminUserId: adminId,
        action: 'CAMPAIGN_CANCELLED',
        entityType: 'BulkNotificationCampaign',
        entityId: id,
        oldValue: { status: campaign.status },
        newValue: { status: 'CANCELLED' },
        ipAddress,
      },
    });

    return result;
  }

  private async requireCampaign(id: string) {
    const campaign = await this.prisma.bulkNotificationCampaign.findUnique({ where: { id } });
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }
    return campaign;
  }
}
