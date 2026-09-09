import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PlatformUserStatus } from '@prisma/client';
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

  // SIMULATED send: no real email/SMS/push provider (e.g. SendGrid, Twilio,
  // or a local SMS gateway) is wired up. This computes a real target
  // audience from targetFilter against seeded PlatformUsers, then generates
  // a realistic 95-99% success rate and writes matching NotificationLog rows
  // -- exactly the shape a real provider's delivery webhook would eventually
  // report back, so swapping in a real provider later only needs to replace
  // this method's body.
  async send(id: string, adminId: string, ipAddress?: string) {
    const campaign = await this.requireCampaign(id);
    if (!SENDABLE_STATUSES.includes(campaign.status)) {
      throw new BadRequestException('Only DRAFT or SCHEDULED campaigns can be sent');
    }

    await this.prisma.bulkNotificationCampaign.update({ where: { id }, data: { status: 'SENDING' } });

    const filter = campaign.targetFilter as { planId?: string; status?: PlatformUserStatus };
    const where: Prisma.PlatformUserWhereInput = {};
    if (filter.planId) where.planId = filter.planId;
    if (filter.status) where.status = filter.status;

    const targetUsers = await this.prisma.platformUser.findMany({ where, select: { id: true } });

    const successRate = 0.95 + Math.random() * 0.04;
    let sentCount = 0;
    let failedCount = 0;
    const logs: Prisma.NotificationLogCreateManyInput[] = targetUsers.map((user) => {
      const isSuccess = Math.random() < successRate;
      if (isSuccess) sentCount++;
      else failedCount++;
      return {
        platformUserId: user.id,
        templateKey: campaign.templateKey,
        channel: campaign.channel,
        status: isSuccess ? 'SENT' : 'FAILED',
        sentAt: isSuccess ? new Date() : null,
        errorMessage: isSuccess ? null : 'Simulated delivery failure',
      };
    });

    if (logs.length > 0) {
      await this.prisma.notificationLog.createMany({ data: logs });
    }

    const result = await this.prisma.bulkNotificationCampaign.update({
      where: { id },
      data: { status: 'SENT', sentCount, failedCount },
    });

    await this.prisma.auditLog.create({
      data: {
        adminUserId: adminId,
        action: 'CAMPAIGN_SENT',
        entityType: 'BulkNotificationCampaign',
        entityId: id,
        newValue: { sentCount, failedCount, targetCount: targetUsers.length },
        ipAddress,
      },
    });

    return result;
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
