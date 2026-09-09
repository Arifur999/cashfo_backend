import { Injectable } from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(role: AdminRole) {
    const thirtyDaysAgo = new Date(Date.now() - THIRTY_DAYS_MS);
    const canSeeRevenue = role === AdminRole.SUPER_ADMIN || role === AdminRole.FINANCE_ADMIN;
    const isSuperAdmin = role === AdminRole.SUPER_ADMIN;

    const [totalUsers, newUsersLast30d, openTickets, mrr, pendingFlags, lastBackup, recentAuditLogs] = await Promise.all([
      this.prisma.platformUser.count(),
      this.prisma.platformUser.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      this.prisma.supportTicket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
      canSeeRevenue ? this.computeMrr() : Promise.resolve(null),
      isSuperAdmin ? this.prisma.suspiciousActivityFlag.count({ where: { status: 'OPEN' } }) : Promise.resolve(null),
      isSuperAdmin
        ? this.prisma.backupRecord.findFirst({ where: { status: 'SUCCESS' }, orderBy: { completedAt: 'desc' } })
        : Promise.resolve(null),
      isSuperAdmin
        ? this.prisma.auditLog.findMany({
            take: 5,
            orderBy: { createdAt: 'desc' },
            include: { adminUser: { select: { name: true } } },
          })
        : Promise.resolve(null),
    ]);

    return {
      totalUsers,
      newUsersLast30d,
      openTickets,
      mrr,
      pendingFlags,
      lastBackup: lastBackup ? { completedAt: lastBackup.completedAt, sizeMb: lastBackup.sizeMb } : null,
      recentAuditLogs:
        recentAuditLogs?.map((log) => ({
          id: log.id,
          action: log.action,
          entityType: log.entityType,
          adminName: log.adminUser.name,
          createdAt: log.createdAt,
        })) ?? null,
    };
  }

  // Mirrors RevenueService.summary()'s MRR slice -- duplicated rather than
  // injected across modules since RevenueService isn't exported from
  // RevenueModule, and this is only ~10 lines.
  private async computeMrr(): Promise<number> {
    const activePaidUsers = await this.prisma.platformUser.findMany({
      where: { status: 'ACTIVE', plan: { billingCycle: { not: 'FREE' } } },
      select: { plan: { select: { price: true, billingCycle: true } } },
    });
    const mrr = activePaidUsers.reduce((sum, u) => {
      if (!u.plan) return sum;
      const price = Number(u.plan.price);
      return sum + (u.plan.billingCycle === 'YEARLY' ? price / 12 : price);
    }, 0);
    return Math.round(mrr * 100) / 100;
  }
}
