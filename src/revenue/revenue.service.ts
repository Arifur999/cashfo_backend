import { Injectable } from '@nestjs/common';
import { BillingCycle, PaymentStatus } from '@prisma/client';
import { dhakaDateKey, dhakaMonthStart, dhakaToday } from '../common/dhaka.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { monthEnds, paidPeopleAt } from '../subscription-plans/plan-history.js';
import { computeMrr, PAYING_WORKSPACE_WHERE } from './mrr.js';

// Payments that brought money in: refunds are subtracted separately.
const REVENUE_STATUSES: PaymentStatus[] = [PaymentStatus.SUCCESS, PaymentStatus.REFUNDED];

// How far back the MRR-by-month chart looks.
const HISTORY_MONTHS = 6;

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

  // The Revenue page: MRR and ARR as the dashboard counts them (from the
  // workspaces' plans), and everything the payments themselves tell --
  // paid people at each of the last six month ends and the MRR they
  // carried, who joined and left this month, this month's takings by
  // plan, its refunds and what coupons cost.
  async overview() {
    const now = new Date();
    const { year, month } = dhakaToday();
    const thisMonthStart = dhakaMonthStart(year, month);
    const ends = monthEnds(now, HISTORY_MONTHS);
    const lookBack = new Date(Date.UTC(ends[0].at.getUTCFullYear() - 1, ends[0].at.getUTCMonth(), 1));

    const [plans, payments, churn, mrr] = await Promise.all([
      this.prisma.subscriptionPlan.findMany({ select: { id: true, name: true, billingCycle: true, price: true } }),
      this.prisma.payment.findMany({
        where: { status: { in: REVENUE_STATUSES }, createdAt: { gte: lookBack } },
        select: {
          platformUserId: true,
          planId: true,
          amount: true,
          discountApplied: true,
          couponId: true,
          paidAt: true,
          createdAt: true,
          refund: { select: { amount: true, status: true, createdAt: true } },
        },
      }),
      this.churn(),
      computeMrr(this.prisma),
    ]);

    const monthlyPrice = new Map(plans.map((plan) => [plan.id, plan.billingCycle === BillingCycle.YEARLY ? Number(plan.price) / 12 : Number(plan.price)]));
    const paid = payments.map((payment) => ({ platformUserId: payment.platformUserId, planId: payment.planId, paidAt: payment.paidAt ?? payment.createdAt }));
    const peopleAt = (at: Date) => paidPeopleAt(paid, plans, at);
    const everyone = (sets: Map<string, Set<string>>) => new Set([...sets.values()].flatMap((people) => [...people]));

    const mrrHistory = ends.map(({ month: key, at }) => {
      let total = 0;
      for (const [planId, people] of peopleAt(at)) total += people.size * (monthlyPrice.get(planId) ?? 0);
      return { month: key, mrr: Math.round(total * 100) / 100 };
    });
    const lastMonthEnd = ends[ends.length - 2];
    const paidNow = everyone(peopleAt(now));
    const paidAtLastMonthEnd = lastMonthEnd ? everyone(peopleAt(lastMonthEnd.at)) : new Set<string>();
    const leftThisMonth = [...paidAtLastMonthEnd].filter((person) => !paidNow.has(person)).length;
    // Joined: paid now, never inside a paid period before this month began.
    const paidBefore = everyone(peopleAt(new Date(thisMonthStart.getTime() - 1)));
    const joinedThisMonth = [...paidNow].filter((person) => !paidBefore.has(person)).length;

    const thisMonth = payments.filter((payment) => payment.createdAt >= thisMonthStart);
    const net = (payment: (typeof payments)[number]) => Number(payment.amount) - (payment.refund?.status === 'COMPLETED' ? Number(payment.refund.amount) : 0);
    const byPlan = new Map<string, { payments: number; amount: number }>();
    for (const payment of thisMonth) {
      const entry = byPlan.get(payment.planId) ?? { payments: 0, amount: 0 };
      entry.payments += 1;
      entry.amount += net(payment);
      byPlan.set(payment.planId, entry);
    }
    const refundsThisMonth = payments.filter((payment) => payment.refund?.status === 'COMPLETED' && payment.refund.createdAt >= thisMonthStart);

    return {
      month: dhakaDateKey(thisMonthStart).slice(0, 7),
      mrr,
      arr: Math.round(mrr * 12 * 100) / 100,
      mrrChangePct:
        lastMonthEnd && mrrHistory[mrrHistory.length - 2].mrr > 0
          ? Math.round(((mrrHistory[mrrHistory.length - 1].mrr - mrrHistory[mrrHistory.length - 2].mrr) / mrrHistory[mrrHistory.length - 2].mrr) * 1000) / 10
          : null,
      paidPeople: { now: paidNow.size, joinedThisMonth, leftThisMonth },
      churn,
      mrrHistory,
      byPlan: plans
        .filter((plan) => byPlan.has(plan.id))
        .map((plan) => {
          const entry = byPlan.get(plan.id)!;
          return { planId: plan.id, planName: plan.name, payments: entry.payments, amount: (Math.round(entry.amount * 100) / 100).toFixed(2) };
        })
        .sort((a, b) => Number(b.amount) - Number(a.amount)),
      thisMonthTotal: (Math.round(thisMonth.reduce((sum, payment) => sum + net(payment), 0) * 100) / 100).toFixed(2),
      refundsThisMonth: {
        count: refundsThisMonth.length,
        amount: (Math.round(refundsThisMonth.reduce((sum, payment) => sum + Number(payment.refund?.amount ?? 0), 0) * 100) / 100).toFixed(2),
      },
      couponsCostThisMonth: (
        Math.round(thisMonth.filter((payment) => payment.couponId).reduce((sum, payment) => sum + Number(payment.discountApplied ?? 0), 0) * 100) / 100
      ).toFixed(2),
    };
  }
}
