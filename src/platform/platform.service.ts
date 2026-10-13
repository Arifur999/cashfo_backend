import { Injectable } from '@nestjs/common';
import { AnnouncementsService } from '../announcements/announcements.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { FeatureFlagsService } from '../system/feature-flags.service.js';

// What the admin panel configures that the customer app has to see: the
// platform name and support address, maintenance mode, feature flags and
// announcements -- one read for the customer layout instead of four.
@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly featureFlagsService: FeatureFlagsService,
    private readonly announcementsService: AnnouncementsService,
  ) {}

  // For pages anyone can open (sign-in, sign-up): no flags or
  // announcements, which depend on who is asking.
  async publicInfo() {
    const settings = await this.settingsService.getCached();
    return {
      platformName: settings.platformName,
      supportEmail: settings.supportEmail,
      maintenance: { enabled: settings.maintenanceMode, message: settings.maintenanceMessage },
    };
  }

  async forCustomer(userId: string) {
    const [info, owned] = await Promise.all([
      this.publicInfo(),
      this.prisma.business.findMany({ where: { ownerId: userId, deletedAt: null, planId: { not: null } }, select: { planId: true } }),
    ]);
    // Plan-targeted flags and announcements match any plan one of the
    // customer's own workspaces is on.
    const planIds = [...new Set(owned.map((b) => b.planId!))];
    const [flags, announcements] = await Promise.all([
      this.featureFlagsService.evaluateAllFor(userId, planIds),
      this.announcementsService.forCustomer(planIds),
    ]);
    return { ...info, flags, announcements };
  }
}
