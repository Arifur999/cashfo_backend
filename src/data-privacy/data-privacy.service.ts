import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { resolvePrefs } from '../notification-prefs/notification-prefs.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpdatePrivacyDto } from './dto/update-privacy.dto.js';

// Settings › Data & privacy: what the person's records hold at a glance,
// and their privacy switches. AI Insights' own switches live in
// /api/insights/settings.
@Injectable()
export class DataPrivacyService {
  constructor(private readonly prisma: PrismaService) {}

  async page(userId: string) {
    const [user, owned, groups] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { shareUsage: true, showNameInGroups: true, notificationPrefs: true, aiInsights: true, aiReads: true } }),
      this.prisma.business.findMany({ where: { ownerId: userId, deletedAt: null, type: { not: 'GROUP' } }, select: { id: true } }),
      this.prisma.businessMember.count({ where: { userId, status: 'ACTIVE', business: { type: 'GROUP', deletedAt: null } } }),
    ]);
    const businessId = { in: owned.map((row) => row.id) };
    const [transactions, accounts, goals, contacts, assets, events] = await Promise.all([
      this.prisma.transaction.count({ where: { businessId, status: 'POSTED', reversalOfId: null } }),
      this.prisma.account.count({ where: { businessId, accountType: 'ASSET', accountSubtype: { in: ['cash', 'bank', 'mfs'] }, status: { not: 'ARCHIVED' } } }),
      this.prisma.savingsGoal.count({ where: { businessId } }),
      this.prisma.contact.count({ where: { businessId, category: 'LOAN' } }),
      this.prisma.asset.count({ where: { businessId } }),
      this.prisma.socialEvent.count({ where: { businessId } }),
    ]);
    return {
      glance: { transactions, accounts, goals, loanContacts: contacts, assets, groups, events },
      privacy: { shareUsage: user.shareUsage, showNameInGroups: user.showNameInGroups, marketingEmails: resolvePrefs(user.notificationPrefs).alerts.news.email },
      ai: { on: user.aiInsights, reads: user.aiReads },
    };
  }

  async update(userId: string, dto: UpdatePrivacyDto) {
    const data: Prisma.UserUpdateInput = {
      ...(dto.shareUsage !== undefined && { shareUsage: dto.shareUsage }),
      ...(dto.showNameInGroups !== undefined && { showNameInGroups: dto.showNameInGroups }),
    };
    if (dto.marketingEmails !== undefined) {
      const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { notificationPrefs: true } });
      const prefs = resolvePrefs(user.notificationPrefs);
      prefs.alerts.news = { ...prefs.alerts.news, email: dto.marketingEmails };
      data.notificationPrefs = prefs as unknown as Prisma.InputJsonObject;
    }
    await this.prisma.user.update({ where: { id: userId }, data });
    return this.page(userId);
  }
}
