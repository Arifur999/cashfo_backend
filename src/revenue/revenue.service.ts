import { Injectable } from '@nestjs/common';
import { BillingCycle, PaymentStatus, PlatformUserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

@Injectable()
export class RevenueService {
  constructor(private readonly prisma: PrismaService) {}

  async summary() {
    const now = new Date();
    const thisMonthStart = startOfMonth(now);
    const lastMonthStart = new Date(thisMonthStart.getFullYear(), thisMonthStart.getMonth() - 1, 1);
    const twelveMonthsAgo = new Date(thisMonthStart.getFullYear(), thisMonthStart.getMonth() - 11, 1);

    const successfulPayments = await this.prisma.payment.findMany({
      where: { status: PaymentStatus.SUCCESS, createdAt: { gte: twelveMonthsAgo } },
      select: { amount: true, createdAt: true, planId: true, plan: { select: { name: true } } },
    });

    // All-time total needs its own query -- successfulPayments above is
    // scoped to the last 12 months for the trend chart.
    const allTimeAgg = await this.prisma.payment.aggregate({
      where: { status: PaymentStatus.SUCCESS },
      _sum: { amount: true },
    });

    let thisMonthRevenue = 0;
    let lastMonthRevenue = 0;
    const revenueByPlan = new Map<string, { planName: string; amount: number }>();
    const trendByMonth = new Map<string, number>();

    for (const payment of successfulPayments) {
      const amount = Number(payment.amount);
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
      const d = new Date(thisMonthStart.getFullYear(), thisMonthStart.getMonth() - i, 1);
      const key = monthKey(d);
      trend.push({ month: key, amount: trendByMonth.get(key) ?? 0 });
    }

    // MRR: currently-ACTIVE platform users on a paid plan, monthly-normalized
    // (yearly plan price / 12).
    const activePaidUsers = await this.prisma.platformUser.findMany({
      where: { status: PlatformUserStatus.ACTIVE, plan: { billingCycle: { not: BillingCycle.FREE } } },
      select: { plan: { select: { price: true, billingCycle: true } } },
    });
    const mrr = activePaidUsers.reduce((sum, u) => {
      if (!u.plan) return sum;
      const price = Number(u.plan.price);
      return sum + (u.plan.billingCycle === BillingCycle.YEARLY ? price / 12 : price);
    }, 0);

    return {
      totalRevenue: Number(allTimeAgg._sum.amount ?? 0),
      thisMonthRevenue,
      lastMonthRevenue,
      mrr: Math.round(mrr * 100) / 100,
      revenueByPlan: [...revenueByPlan.entries()].map(([planId, v]) => ({ planId, ...v })),
      revenueTrend: trend,
    };
  }

  async churn() {
    const now = new Date();
    const thisMonthStart = startOfMonth(now);

    const freePlan = await this.prisma.subscriptionPlan.findFirst({ where: { billingCycle: BillingCycle.FREE } });

    const currentPaidCount = await this.prisma.platformUser.count({
      where: { plan: { billingCycle: { not: BillingCycle.FREE } } },
    });

    let churnedThisMonth = 0;
    if (freePlan) {
      churnedThisMonth = await this.prisma.planChangeLog.count({
        where: {
          toPlanId: freePlan.id,
          fromPlanId: { not: freePlan.id },
          createdAt: { gte: thisMonthStart },
        },
      });
    }

    // Approximation: since we don't keep a historical daily snapshot, "paid
    // subscribers at the start of the month" is estimated as today's paid
    // count plus everyone who churned away from a paid plan this month.
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
