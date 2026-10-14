import { Injectable } from '@nestjs/common';
import { LegalDocType } from '@prisma/client';
import { AnnouncementsService } from '../announcements/announcements.service.js';
import { LegalDocumentsService } from '../legal-documents/legal-documents.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { FeatureFlagsService } from '../system/feature-flags.service.js';

// What the admin panel configures that the customer app has to see: the
// platform name and support address, maintenance mode, feature flags,
// announcements and translations -- one read for the customer layout
// instead of four.
@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly featureFlagsService: FeatureFlagsService,
    private readonly announcementsService: AnnouncementsService,
    private readonly legalDocumentsService: LegalDocumentsService,
  ) {}

  // A legal page as the admin last saved it (Content > Legal), for the
  // public Terms, Privacy, Refund policy and FAQ pages.
  async legalDocument(type: LegalDocType) {
    const doc = await this.legalDocumentsService.getByType(type);
    return { type: doc.type, contentEn: doc.contentEn, contentBn: doc.contentBn, version: doc.version, updatedAt: doc.updatedAt };
  }

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

  // Content > Translations, the way the app looks text up: its English
  // wording is the key, so each string's Bangla replaces the app's own for
  // the same English. Blank ones are skipped, and of two strings with the
  // same English the one edited last wins.
  async translations() {
    const strings = await this.prisma.translationString.findMany({ select: { en: true, bn: true }, orderBy: { updatedAt: 'asc' } });
    // A Map, so no English text (not even __proto__) reaches an object's prototype.
    const bn = new Map<string, string>();
    for (const { en, bn: text } of strings) {
      if (en.trim() && text.trim()) bn.set(en.trim(), text.trim());
    }
    return { bn: Object.fromEntries(bn) };
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
