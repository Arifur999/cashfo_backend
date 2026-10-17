import { BadRequestException, Injectable, NotFoundException, NotImplementedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { END_USER_WHERE } from '../common/roles.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateCampaignDto } from './dto/create-campaign.dto.js';

const SENDABLE_STATUSES = ['DRAFT', 'SCHEDULED'];

@Injectable()
export class NotificationCampaignsService {
  constructor(private readonly prisma: PrismaService) {}

  // Each campaign with how many people its filter reaches right now.
  async list() {
    const campaigns = await this.prisma.bulkNotificationCampaign.findMany({ orderBy: { createdAt: 'desc' } });
    return Promise.all(
      campaigns.map(async (campaign) => ({
        ...campaign,
        audienceCount: await this.audienceCount(campaign.targetFilter as { planId?: string; status?: string }),
      })),
    );
  }

  // How many real customers a target filter reaches: by account status
  // (the legacy statuses that have no customer counterpart match nobody)
  // and by the plan of their default workspace.
  audienceCount(filter: { planId?: string; status?: string }): Promise<number> {
    const status = filter.status === 'ACTIVE' || filter.status === 'SUSPENDED' ? filter.status : filter.status ? 'DELETED' : undefined;
    return this.prisma.user.count({
      where: {
        ...END_USER_WHERE,
        ...(status && { status }),
        ownedBusinesses: { some: { deletedAt: null, isDefault: true, ...(filter.planId && { planId: filter.planId }) } },
      },
    });
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
    throw new NotImplementedException('Real notification delivery is not wired up yet -- no email/SMS/push provider is integrated in this app.');
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
