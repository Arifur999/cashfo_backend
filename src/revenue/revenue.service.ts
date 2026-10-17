import { Injectable } from '@nestjs/common';
import { BillingCycle, PaymentStatus } from '@prisma/client';
import { dhakaDateKey, dhakaMonthStart, dhakaToday } from '../common/dhaka.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { computeMrr, PAYING_WORKSPACE_WHERE } from './mrr.js';

// Payments that brought money in: refunds are subtracted separately.
const REVENUE_STATUSES: PaymentStatus[] = [PaymentStatus.SUCCESS, PaymentStatus.REFUNDED];

// 'YYYY-MM' of the Dhaka month an instant falls in.
function monthKey(date: Date): string {
  return dhakaDateKey(date).slice(0, 7);
}

@Injectable()
export class RevenueService {
  constructor(private readonly prisma: PrismaService) {}

  async summary() {
    const { year, month } = dhakaToday();
    const thisMonthStart = dhakaMonthStart(year, month);
    const lastMonthStart = dhakaMonthStart(year, month - 1);
    const twelveMonthsAgo = dhakaMonthStart(year, month - 11);

    // Revenue is net of refunds: a refunded payment (status REFUNDED, whether
    // the refund was the whole amount or part of it) still counts, minus what
    // was actually given back. Counting only SUCCESS dropped the whole
    // payment for a partial refund.
    const keptPayments = await this.prisma.payment.findMany({
      where: { status: { in: REVENUE_STATUSES }, createdAt: { gte: twelveMonthsAgo } },
      select: { amount: true, createdAt: true, planId: true, plan: { select: { name: true } }, refund: { select: { amount: true, status: true } } },
    });

    // All-time total needs its own queries -- keptPayments above is scoped
    // to the last 12 months for the trend chart.
    const [allTimeAgg, allTimeRefundAgg, mrr] = await Promise.all([
      this.prisma.payment.aggregate({ where: { status: { in: REVENUE_STATUSES } }, _sum: { amount: true } }),
      this.prisma.refund.aggregate({ where: { status: 'COMPLETED', payment: { status: { in: REVENUE_STATUSES } } }, _sum: { amount: true } }),
      computeMrr(this.prisma),
    ]);

    let thisMonthRevenue = 0;
    let lastMonthRevenue = 0;
    const revenueByPlan = new Map<string, { planName: string; amount: number }>();
    const trendByMonth = new Map<string, number>();

    for (const payment of keptPayments) {
      const refunded = payment.refund?.status === 'COMPLETED' ? Number(payment.refund.amount) : 0;
      const amount = Number(payment.amount) - refunded;
      if (payment.createdAt >= thisMonthStart) thisMonthRevenue += amount;
      else if (payment.createdAt >= lastMonthStart && payment.createdAt < thisMonthStart) lastMonthRevenue += amount;

      const planEntry = revenueByPlan.get(payment.planId) ?? { planName: payment.plan.name, amount: 0 };
      planEntry.amount += amount;
      revenueByPlan.set(payment.planId, planEntry);

      const key = monthKey(payment.createdAt);
      trendByMonth.set(key, (trendByMonth.get(key) ?? 0) + amount);
    }

    // Fill in the full 12-month range so months with zero revenue still show
    // up in the chart instead of being skipped.
    const trend: { month: string; amount: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const key = new Date(Date.UTC(year, month - 1 - i, 1)).toISOString().slice(0, 7);
      trend.push({ month: key, amount: Math.round((trendByMonth.get(key) ?? 0) * 100) / 100 });
    }

    return {
      totalRevenue: Math.round((Number(allTimeAgg._sum.amount ?? 0) - Number(allTimeRefundAgg._sum.amount ?? 0)) * 100) / 100,
      thisMonthRevenue: Math.round(thisMonthRevenue * 100) / 100,
      lastMonthRevenue: Math.round(lastMonthRevenue * 100) / 100,
      mrr,
      revenueByPlan: [...revenueByPlan.entries()].map(([planId, v]) => ({ planId, ...v, amount: Math.round(v.amount * 100) / 100 })),
      revenueTrend: trend,
    };
  }

  // Churn from the workspaces themselves: today's paying workspaces, and
  // those an admin moved from a paid plan to the free one this (Dhaka)
  // month -- AdminOwnersService.changePlan() writes BUSINESS_PLAN_CHANGED
  // with the old and new plan ids. The legacy PlanChangeLog/PlatformUser
  // tables this used to read are written by nothing.
  async churn() {
    const { year, month } = dhakaToday();
    const thisMonthStart = dhakaMonthStart(year, month);

    const freePlan = await this.prisma.subscriptionPlan.findFirst({ where: { billingCycle: BillingCycle.FREE } });
    const currentPaidCount = await this.prisma.business.count({ where: PAYING_WORKSPACE_WHERE });

    let churnedThisMonth = 0;
    if (freePlan) {
      const downgrades = await this.prisma.auditLog.findMany({
        where: { action: 'BUSINESS_PLAN_CHANGED', createdAt: { gte: thisMonthStart }, newValue: { path: ['planId'], equals: freePlan.id } },
        select: { entityId: true, oldValue: true },
      });
      const churned = new Set(
        downgrades.filter((log) => (log.oldValue as { planId?: string | null } | null)?.planId !== freePlan.id).map((log) => log.entityId),
      );
      churnedThisMonth = churned.size;
    }

    // Approximation: there is no historical snapshot, so "paid workspaces at
    // the start of the month" is today's paid count plus every workspace
    // that churned away from a paid plan this month.
    const startOfMonthPaidCount = currentPaidCount + churnedThisMonth;
    const churnRate = startOfMonthPaidCount > 0 ? churnedThisMonth / startOfMonthPaidCount : 0;

    return {
      churnedThisMonth,
      startOfMonthPaidCount,
      currentPaidCount,
      churnRatePercent: Math.round(churnRate * 10000) / 100,
    };
  }
}
