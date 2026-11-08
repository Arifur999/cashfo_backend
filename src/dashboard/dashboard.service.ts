import { BadRequestException, Injectable } from '@nestjs/common';
import { BillingCycle, FlagStatus, Prisma, Severity, UserStatus } from '@prisma/client';
import { AnalyticsService } from '../analytics/analytics.service.js';
import { dhakaDateKey } from '../common/dhaka.js';
import { AdminRole, END_USER_WHERE } from '../common/roles.js';
import { payerIdOf, requesterNames } from '../admin-feed/requester-names.js';
import { auditReason, withEntityLabels } from '../audit-logs/audit-entity-labels.js';
import { SystemHealthService } from '../health/system-health.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { computeMrr, PAID_SUBSCRIPTION_WHERE, REVENUE_STATUSES } from '../revenue/mrr.js';
import { RevenueService } from '../revenue/revenue.service.js';
import { paidPeopleAt } from '../subscription-plans/plan-history.js';
import {
  accountsByPlan,
  type DashboardPeriod,
  lastFullMonths,
  pctChange,
  perDhakaDay,
  periodDays,
  shareOf,
  ticketsNoReply,
  waitingForReply,
} from './dashboard-maths.js';
import { addDays, countsPer, type DashboardRange, dhakaStartOf, lastDayOf, previousSpan, resolveDashboardRange, revenueMonths } from './dashboard-period.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const HIGH: Severity[] = [Severity.HIGH, Severity.CRITICAL];

// A channel that is set up and whose last send (if any) went through.
const canSend = (channel: { configured: boolean; lastSendOk: boolean | null }) => channel.configured && channel.lastSendOk !== false;
// Raised and not yet closed: what the Security page counts as needing a look.
const NEEDS_A_LOOK: FlagStatus[] = [FlagStatus.OPEN, FlagStatus.REVIEWING];
const UNSOLVED = { status: { notIn: ['RESOLVED', 'CLOSED'] } } satisfies Prisma.SupportTicketWhereInput;
// A ticket's newest message the customer saw (notes for admins left out).
const NEWEST_MESSAGE = { where: { isInternal: false }, orderBy: { createdAt: 'desc' }, take: 1, select: { senderType: true, createdAt: true } } as const;
// The support team's goal: an answer within a day.
const REPLY_GOAL_MS = DAY_MS;
const SIGN_IN_ACTIONS = ['ADMIN_LOGIN'];
// Every customer who signed up: a live workspace, or purged (no workspaces
// left) -- the Users list's "All" tab.
const SIGNED_UP: Prisma.UserWhereInput = { ...END_USER_WHERE, OR: [{ ownedBusinesses: { some: { deletedAt: null } } }, { status: UserStatus.DELETED }] };
// Customers whose account is gone or going: left out of "Accounts by plan".
const DELETED_STATUSES: UserStatus[] = [UserStatus.DELETED, UserStatus.PENDING_DELETION];
// The earliest day the period picker may start on.
const EARLIEST_DAY = '2000-01-01';

// Gone by `at`: deleted, or asked to be, before then. A deleted account with
// no request time on it counts as gone all along.
const goneBy = (at: Date): Prisma.UserWhereInput => ({
  status: { in: DELETED_STATUSES },
  OR: [{ deletionRequestedAt: null }, { deletionRequestedAt: { lt: at } }],
});
// Customers who had signed up by `at` and were still there.
const liveAt = (at: Date): Prisma.UserWhereInput => ({ ...SIGNED_UP, createdAt: { lt: at }, NOT: goneBy(at) });

export interface DashboardAdmin {
  id: string;
  role: AdminRole;
}

// The admin dashboard in one call (AdminDashboard; AdminDashboardSupport for
// a support admin). Each role gets its cut: money (MRR, revenue, paid users,
// plans, payouts, failed payments) for super and finance admins; security,
// errors, the system list and admin activity for super admins; tickets for
// super and support admins, and a support admin's own queue. A part a role
// doesn't get is null.
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
    private readonly revenue: RevenueService,
    private readonly health: SystemHealthService,
  ) {}

  async summary(admin: DashboardAdmin | AdminRole, period: DashboardPeriod = '30d') {
    const { role, id: adminId } = typeof admin === 'string' ? { role: admin, id: null } : admin;
    const now = new Date();
    const isSuper = role === AdminRole.SUPER_ADMIN;
    const seesMoney = isSuper || role === AdminRole.FINANCE_ADMIN;
    const seesTickets = isSuper || role === AdminRole.SUPPORT_ADMIN;
    const days = periodDays(period);
    const periodStart = new Date(now.getTime() - days * DAY_MS);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
    const dayAgo = new Date(now.getTime() - DAY_MS);

    const [totalUsers, newUsersLast30d, signups, active, openTickets] = await Promise.all([
      this.prisma.user.count({ where: SIGNED_UP }),
      this.prisma.user.count({ where: { ...SIGNED_UP, createdAt: { gte: thirtyDaysAgo } } }),
      this.prisma.user.findMany({ where: { ...SIGNED_UP, createdAt: { gte: periodStart } }, select: { createdAt: true } }),
      this.analytics.summary(now),
      this.prisma.supportTicket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
    ]);
    const signupsPerDay = perDhakaDay(
      signups.map((user) => user.createdAt),
      days,
      now,
    );

    const [money, superParts, tickets, support] = await Promise.all([
      seesMoney ? this.moneyParts(now, weekAgo) : null,
      isSuper ? this.superParts(dayAgo) : null,
      seesTickets ? this.unanswered() : null,
      role === AdminRole.SUPPORT_ADMIN && adminId ? this.supportCut(adminId, now, weekAgo) : null,
    ]);

    return {
      period,
      // The figures as they were before the board's redesign, kept for the
      // older admin pages.
      totalUsers,
      newUsersLast30d,
      openTickets,
      mrr: money?.mrr ?? null,
      pendingFlags: superParts?.securityFlags.open ?? null,
      lastBackup: superParts?.lastBackup ?? null,
      recentAuditLogs: superParts?.recentAuditLogs ?? null,

      // "Needs you now". Each card is null for a role that doesn't see it.
      attention: {
        payoutRequests: money?.payoutRequests ?? null,
        ticketsNoReply: tickets,
        failedPayments7d: money?.failedPayments7d ?? null,
        securityFlags: superParts?.securityFlags ?? null,
        newErrors24h: superParts?.errors24h ?? null,
      },
      // The KPI row.
      users: {
        total: totalUsers,
        newInPeriod: signups.length,
        newLast30d: newUsersLast30d,
        newLast7d: signups.filter((user) => user.createdAt >= weekAgo).length,
      },
      activeLast30d: active.activeLast30d,
      activePct: shareOf(active.activeLast30d, active.totalAccounts),
      paidUsers: money?.paidUsers ?? null,
      mrrChangePct: money?.mrrChangePct ?? null,
      arr: money?.arr ?? null,
      // Sign-ups per Dhaka day over the period, oldest first.
      signupsPerDay,
      // Money in, net of refunds, for the six whole months before this one,
      // and this month so far.
      revenueByMonth: money?.revenueByMonth ?? null,
      revenueChangePct: money?.revenueChangePct ?? null,
      revenueThisMonth: money?.revenueThisMonth ?? null,
      accountsByPlan: money?.accountsByPlan ?? null,
      deletedLeftOut: money?.deletedLeftOut ?? null,
      system: superParts?.system ?? null,
      // A support admin's own dashboard (AdminDashboardSupport).
      support,
    };
  }

  // GET admin/dashboard/overview?from=&to= -- the AdminDashboard board with
  // its "Choose period" picker: the people and money figures as they stood
  // on the period's last day (as of now while it runs to today), its
  // sign-ups a bar a day or a month, and its revenue against the span
  // before. "Needs you now", admin activity and System are always now.
  async overview(admin: DashboardAdmin, query: { from: string; to: string }) {
    if (query.from > query.to) throw new BadRequestException('"from" must be on or before "to"');
    if (query.from < EARLIEST_DAY) throw new BadRequestException(`Pick a period from ${EARLIEST_DAY} on`);
    const now = new Date();
    const range = resolveDashboardRange(query.from, query.to, dhakaDateKey(now));
    const isSuper = admin.role === AdminRole.SUPER_ADMIN;
    const seesMoney = isSuper || admin.role === AdminRole.FINANCE_ADMIN;
    const seesTickets = isSuper || admin.role === AdminRole.SUPPORT_ADMIN;
    const start = dhakaStartOf(range.from);
    const endExclusive = dhakaStartOf(addDays(range.to, 1));
    // The moment the figures are counted at: the period's end, or now.
    const end = range.isNow ? now : endExclusive;
    const inPeriod = { gte: start, lt: endExclusive };

    const [total, signups, newLast7d, liveAccounts, active, money, attentionMoney, superParts, tickets] = await Promise.all([
      this.prisma.user.count({ where: { ...SIGNED_UP, createdAt: { lt: end } } }),
      this.prisma.user.findMany({ where: { ...SIGNED_UP, createdAt: inPeriod }, select: { createdAt: true } }),
      this.prisma.user.count({ where: { ...SIGNED_UP, createdAt: { gte: dhakaStartOf(addDays(range.to, -6)), lt: endExclusive } } }),
      this.prisma.user.count({ where: liveAt(end) }),
      // Active: a session made or used in the period, as Analytics counts it.
      this.prisma.userSession.findMany({
        where: { OR: [{ createdAt: inPeriod }, { lastUsedAt: inPeriod }] },
        select: { userId: true },
        distinct: ['userId'],
      }),
      seesMoney ? this.moneyFor(range, start, end, endExclusive, now) : null,
      seesMoney ? this.moneyAttention(new Date(now.getTime() - 7 * DAY_MS)) : null,
      isSuper ? this.superParts(new Date(now.getTime() - DAY_MS)) : null,
      seesTickets ? this.unanswered() : null,
    ]);

    let accounts = null;
    if (money) {
      const paidTotal = money.paidByPlan.reduce((sum, row) => sum + row.count, 0);
      accounts = {
        paidUsers: { total: paidTotal, pctOfAccounts: shareOf(paidTotal, liveAccounts), byPlan: money.paidByPlan },
        // Every live account under its plan; on a day gone by, the free
        // plan is whoever wasn't inside a paid period then.
        accountsByPlan: accountsByPlan(money.plans, money.planCounts(liveAccounts)),
        deletedLeftOut: money.deletedLeftOut,
      };
    }

    return {
      range,
      attention: {
        payoutRequests: attentionMoney?.payoutRequests ?? null,
        ticketsNoReply: tickets,
        failedPayments7d: attentionMoney?.failedPayments7d ?? null,
        securityFlags: superParts?.securityFlags ?? null,
        newErrors24h: superParts?.errors24h ?? null,
      },
      users: { total, newInPeriod: signups.length, newLast7d },
      active: { count: active.length, accounts: liveAccounts, pct: shareOf(active.length, liveAccounts) },
      // A bar a day, or a bar a month for a year or a long span.
      signups: {
        unit: range.unit,
        points: countsPer(
          signups.map((user) => user.createdAt),
          range,
        ),
      },
      money: money && {
        ...accounts,
        mrr: money.mrr,
        arr: Math.round(money.mrr * 12 * 100) / 100,
        mrrChange: money.mrrChange,
        revenue: money.revenue,
      },
      recentAuditLogs: superParts?.recentAuditLogs ?? null,
      system: superParts?.system ?? null,
    };
  }

  // The money side of a period: who paid and the MRR they carried at its
  // end (the live subscriptions while it runs to today; on a day gone by,
  // whoever was inside a period they had paid for), the MRR change since it
  // began, and its revenue month by month.
  private async moneyFor(range: DashboardRange, start: Date, end: Date, endExclusive: Date, now: Date) {
    const { months, highlight } = revenueMonths(range);
    const windowStart = dhakaStartOf(`${months[0]}-01`);
    const windowEnd = dhakaStartOf(addDays(lastDayOf(months[months.length - 1]), 1));
    const previous = previousSpan(range);
    // A yearly payment keeps someone paid for twelve months.
    const lookBack = new Date(start.getTime() - 400 * DAY_MS);

    const [plans, payments, windowPayments, deletedLeftOut, current, total, before] = await Promise.all([
      this.prisma.subscriptionPlan.findMany({ orderBy: { displayOrder: 'asc' }, select: { id: true, name: true, price: true, billingCycle: true } }),
      this.prisma.payment.findMany({
        where: { status: { in: REVENUE_STATUSES }, OR: [{ paidAt: { gte: lookBack, lt: end } }, { paidAt: null, createdAt: { gte: lookBack, lt: end } }] },
        select: { userId: true, platformUserId: true, planId: true, paidAt: true, createdAt: true },
      }),
      this.prisma.payment.findMany({
        where: { status: { in: REVENUE_STATUSES }, createdAt: { gte: windowStart, lt: windowEnd < now ? windowEnd : now } },
        select: { amount: true, createdAt: true, refund: { select: { amount: true, status: true } } },
      }),
      this.prisma.user.count({ where: { ...END_USER_WHERE, createdAt: { lt: end }, ...goneBy(end) } }),
      range.isNow ? this.currentPaid() : null,
      this.revenueBetween(start, endExclusive),
      this.revenueBetween(dhakaStartOf(previous.from), dhakaStartOf(addDays(previous.to, 1))),
    ]);

    const monthlyPrice = new Map(plans.map((plan) => [plan.id, plan.billingCycle === BillingCycle.YEARLY ? Number(plan.price) / 12 : Number(plan.price)]));
    const paid = payments.flatMap((payment) => {
      const personId = payerIdOf(payment);
      return personId ? [{ personId, planId: payment.planId, paidAt: payment.paidAt ?? payment.createdAt }] : [];
    });
    const historyAt = (at: Date) => paidPeopleAt(paid, plans, at);
    const mrrOf = (people: Map<string, Set<string>>) => {
      let sum = 0;
      for (const [planId, who] of people) sum += who.size * (monthlyPrice.get(planId) ?? 0);
      return Math.round(sum * 100) / 100;
    };
    const atEnd = historyAt(end);
    const historyMrr = mrrOf(atEnd);
    const mrrBefore = mrrOf(historyAt(start));
    const planName = new Map(plans.map((plan) => [plan.id, plan.name]));

    const paidCounts = current ? current.paidCounts : new Map([...atEnd].filter(([, who]) => who.size > 0).map(([planId, who]) => [planId, who.size]));
    const paidByPlan = [...paidCounts].map(([planId, count]) => ({ planId, planName: planName.get(planId) ?? null, count }));
    const paidTotal = paidByPlan.reduce((sum, row) => sum + row.count, 0);

    const byMonth = new Map<string, number>();
    for (const payment of windowPayments) {
      const refunded = payment.refund?.status === 'COMPLETED' ? Number(payment.refund.amount) : 0;
      const key = dhakaDateKey(payment.createdAt).slice(0, 7);
      byMonth.set(key, (byMonth.get(key) ?? 0) + Number(payment.amount) - refunded);
    }
    const changePct = pctChange(total, before);

    return {
      plans,
      paidByPlan,
      // Live accounts by plan id (null = the free plan): today's
      // subscriptions, or on a day gone by the paid periods then running
      // and everyone else on the free plan.
      planCounts: (liveAccounts: number) =>
        current ? current.planCounts : new Map<string | null, number>([...paidCounts, [null, Math.max(0, liveAccounts - paidTotal)]]),
      deletedLeftOut,
      mrr: current ? current.mrr : historyMrr,
      // The MRR the paid periods carried at the end against the start of
      // the period: the same count at both ends, so the change is fair.
      mrrChange: { pct: pctChange(historyMrr, mrrBefore), amount: Math.round((historyMrr - mrrBefore) * 100) / 100, before: mrrBefore },
      revenue: {
        months: months.map((month) => ({ month, amount: (Math.round((byMonth.get(month) ?? 0) * 100) / 100).toFixed(2) })),
        highlight,
        total: total.toFixed(2),
        previous: { ...previous, total: before.toFixed(2) },
        changePct,
      },
    };
  }

  // Who pays today, by plan, and every live account under its plan: the
  // same sets the Revenue page and the older dashboard count.
  private async currentPaid() {
    const [paidRows, byPlanRows, noSubscription, mrr] = await Promise.all([
      this.prisma.userSubscription.groupBy({ by: ['planId'], where: PAID_SUBSCRIPTION_WHERE, _count: true }),
      this.prisma.userSubscription.groupBy({ by: ['planId'], where: { user: { ...SIGNED_UP, status: { notIn: DELETED_STATUSES } } }, _count: true }),
      this.prisma.user.count({ where: { ...SIGNED_UP, status: { notIn: DELETED_STATUSES }, subscription: null } }),
      computeMrr(this.prisma),
    ]);
    const planCounts = new Map<string | null, number>(byPlanRows.map((row) => [row.planId, row._count]));
    planCounts.set(null, (planCounts.get(null) ?? 0) + noSubscription);
    return { paidCounts: new Map(paidRows.map((row) => [row.planId, row._count])), planCounts, mrr };
  }

  // Money in between two instants, net of what was refunded on those payments.
  private async revenueBetween(from: Date, to: Date): Promise<number> {
    const createdAt = { gte: from, lt: to };
    const [paid, refunded] = await Promise.all([
      this.prisma.payment.aggregate({ where: { status: { in: REVENUE_STATUSES }, createdAt }, _sum: { amount: true } }),
      this.prisma.refund.aggregate({ where: { status: 'COMPLETED', payment: { status: { in: REVENUE_STATUSES }, createdAt } }, _sum: { amount: true } }),
    ]);
    return Math.round((Number(paid._sum.amount ?? 0) - Number(refunded._sum.amount ?? 0)) * 100) / 100;
  }

  // "Needs you now" for the money roles: payout requests waiting and
  // payments that failed this week.
  private async moneyAttention(weekAgo: Date) {
    const [payouts, failed] = await Promise.all([
      this.prisma.payoutRequest.aggregate({ where: { status: 'REQUESTED' }, _sum: { amount: true }, _count: { _all: true } }),
      this.prisma.payment.count({ where: { status: 'FAILED', createdAt: { gte: weekAgo } } }),
    ]);
    return { payoutRequests: { count: payouts._count._all, amount: Number(payouts._sum.amount ?? 0).toFixed(2) }, failedPayments7d: { count: failed } };
  }

  private async moneyParts(now: Date, weekAgo: Date) {
    const thisMonth = dhakaDateKey(now).slice(0, 7);
    const [overview, revenueSummary, paidRows, planRows, byPlanRows, noSubscription, deletedLeftOut, attention] = await Promise.all([
      this.revenue.overview(),
      this.revenue.summary(),
      // Paid = a paid plan, active or in its grace days, on a live account
      // (a trial is not paid): the same people MRR is counted from.
      this.prisma.userSubscription.groupBy({ by: ['planId'], where: PAID_SUBSCRIPTION_WHERE, _count: true }),
      this.prisma.subscriptionPlan.findMany({ orderBy: { displayOrder: 'asc' }, select: { id: true, name: true, price: true, billingCycle: true } }),
      this.prisma.userSubscription.groupBy({ by: ['planId'], where: { user: { ...SIGNED_UP, status: { notIn: DELETED_STATUSES } } }, _count: true }),
      this.prisma.user.count({ where: { ...SIGNED_UP, status: { notIn: DELETED_STATUSES }, subscription: null } }),
      this.prisma.user.count({ where: { ...END_USER_WHERE, status: { in: DELETED_STATUSES } } }),
      this.moneyAttention(weekAgo),
    ]);

    const planName = new Map(planRows.map((plan) => [plan.id, plan.name]));
    const paidByPlan = paidRows.map((row) => ({ planId: row.planId, planName: planName.get(row.planId) ?? null, count: row._count }));
    const paidTotal = paidByPlan.reduce((sum, row) => sum + row.count, 0);
    const counts = new Map<string | null, number>(byPlanRows.map((row) => [row.planId, row._count]));
    counts.set(null, (counts.get(null) ?? 0) + noSubscription);
    const plans = accountsByPlan(planRows, counts);
    const liveAccounts = plans.reduce((sum, plan) => sum + plan.count, 0);
    const revenue = lastFullMonths(revenueSummary.revenueTrend, thisMonth, 6);

    return {
      mrr: overview.mrr,
      arr: overview.arr,
      mrrChangePct: overview.mrrChangePct,
      paidUsers: { total: paidTotal, pctOfAccounts: shareOf(paidTotal, liveAccounts), byPlan: paidByPlan },
      revenueByMonth: revenue.months.map((row) => ({ month: row.month, amount: row.amount.toFixed(2) })),
      revenueChangePct: revenue.changePct,
      revenueThisMonth: (revenueSummary.revenueTrend.find((row) => row.month === thisMonth)?.amount ?? 0).toFixed(2),
      accountsByPlan: plans,
      deletedLeftOut,
      ...attention,
    };
  }

  private async superParts(dayAgo: Date) {
    const [flagsOpen, flagsHigh, errors, errorsHigh, lastBackup, recentAuditLogs, health] = await Promise.all([
      this.prisma.suspiciousActivityFlag.count({ where: { status: { in: NEEDS_A_LOOK } } }),
      this.prisma.suspiciousActivityFlag.count({ where: { status: { in: NEEDS_A_LOOK }, severity: { in: HIGH } } }),
      this.prisma.errorLog.count({ where: { resolved: false, createdAt: { gte: dayAgo } } }),
      this.prisma.errorLog.count({ where: { resolved: false, createdAt: { gte: dayAgo }, severity: { in: HIGH } } }),
      this.prisma.backupRecord.findFirst({ where: { status: 'SUCCESS' }, orderBy: { completedAt: 'desc' } }),
      // Changes only: a run of sign-ins would push them off the card (the
      // audit log still lists every sign-in).
      this.prisma.auditLog.findMany({
        where: { action: { notIn: SIGN_IN_ACTIONS } },
        take: 6,
        orderBy: { createdAt: 'desc' },
        include: { adminUser: { select: { name: true, role: true } } },
      }),
      this.health.status(),
    ]);
    const backup = lastBackup ? { completedAt: lastBackup.completedAt, sizeMb: lastBackup.sizeMb } : null;
    const errors24h = { count: errors, high: errorsHigh };
    return {
      securityFlags: { open: flagsOpen, high: flagsHigh },
      errors24h,
      lastBackup: backup,
      // entityLabel names the record ("Yearly Pro", a payer, a ticket's
      // subject); adminRole colours the avatar; reason is what the admin typed.
      recentAuditLogs: (await withEntityLabels(this.prisma, recentAuditLogs)).map((log) => ({
        id: log.id,
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        entityLabel: log.entityLabel,
        adminName: log.adminUser.name,
        adminRole: log.adminUser.role,
        reason: auditReason(log.newValue),
        createdAt: log.createdAt,
      })),
      system: {
        ...health,
        lastBackup: backup,
        errors24h,
        // Everything answers, messages can go out (email or SMS), and
        // nothing high broke today.
        allWorking: health.database.ok && (canSend(health.email) || canSend(health.sms)) && errorsHigh === 0,
      },
    };
  }

  // Tickets the team owes an answer, and since when the longest has waited.
  private async unanswered() {
    const open = await this.prisma.supportTicket.findMany({
      where: UNSOLVED,
      select: { status: true, createdAt: true, messages: NEWEST_MESSAGE },
    });
    return ticketsNoReply(open.map((ticket) => ({ status: ticket.status, createdAt: ticket.createdAt, newest: ticket.messages[0] ?? null })));
  }

  // AdminDashboardSupport: the team's numbers, this admin's own queue, and
  // the most-voted ideas still open.
  private async supportCut(adminId: string, now: Date, weekAgo: Date) {
    const monthAgo = new Date(now.getTime() - 30 * DAY_MS);
    const [byStatus, unsolved, solvedThisWeek, firstReplies, ideas] = await Promise.all([
      this.prisma.supportTicket.groupBy({ by: ['status'], _count: true }),
      this.prisma.supportTicket.findMany({
        where: UNSOLVED,
        select: {
          id: true,
          number: true,
          subject: true,
          status: true,
          priority: true,
          createdAt: true,
          assignedToAdminId: true,
          platformUserId: true,
          messages: NEWEST_MESSAGE,
        },
      }),
      this.prisma.supportTicket.count({ where: { resolvedAt: { gte: weekAgo } } }),
      this.prisma.supportTicket.findMany({
        where: { createdAt: { gte: monthAgo } },
        select: {
          createdAt: true,
          messages: { where: { senderType: 'ADMIN', isInternal: false }, orderBy: { createdAt: 'asc' }, take: 1, select: { createdAt: true } },
        },
      }),
      this.prisma.featureRequest.findMany({
        where: { status: { notIn: ['SHIPPED', 'DECLINED'] } },
        orderBy: [{ voteCount: 'desc' }, { createdAt: 'asc' }],
        take: 3,
        select: { id: true, title: true, status: true, voteCount: true },
      }),
    ]);

    const count = (status: string) => byStatus.find((row) => row.status === status)?._count ?? 0;
    const withWait = unsolved.map((ticket) => ({
      ...ticket,
      waitingSince: waitingForReply({ status: ticket.status, createdAt: ticket.createdAt, newest: ticket.messages[0] ?? null }),
    }));
    const mine = withWait.filter((ticket) => ticket.assignedToAdminId === adminId);
    const late = (since: Date | null) => since !== null && now.getTime() - since.getTime() > REPLY_GOAL_MS;
    const answered = firstReplies.filter((ticket) => ticket.messages.length > 0);
    const avgFirstReplyMinutes = answered.length
      ? Math.round(answered.reduce((sum, ticket) => sum + (ticket.messages[0].createdAt.getTime() - ticket.createdAt.getTime()), 0) / answered.length / 60_000)
      : null;
    // Waiting on us first (longest wait first), then the ones waiting on the user.
    const queue = [...mine]
      .sort(
        (a, b) =>
          Number(b.waitingSince !== null) - Number(a.waitingSince !== null) ||
          (a.waitingSince ?? a.createdAt).getTime() - (b.waitingSince ?? b.createdAt).getTime(),
      )
      .slice(0, 8);
    const names = await requesterNames(
      this.prisma,
      queue.map((ticket) => ticket.platformUserId),
    );

    return {
      openTickets: count('OPEN') + count('IN_PROGRESS'),
      noReply: withWait.filter((ticket) => ticket.waitingSince !== null).length,
      assignedToYou: mine.length,
      assignedToYouPastGoal: mine.filter((ticket) => late(ticket.waitingSince)).length,
      waitingOnUser: count('WAITING_ON_USER'),
      solvedThisWeek,
      avgFirstReplyMinutes,
      queue: queue.map((ticket) => ({
        id: ticket.id,
        number: ticket.number,
        subject: ticket.subject,
        status: ticket.status,
        priority: ticket.priority,
        userName: names.get(ticket.platformUserId) ?? null,
        // Null when the team answered last and the customer hasn't written back.
        waitingSince: ticket.waitingSince,
        pastGoal: late(ticket.waitingSince),
        updatedFrom: ticket.messages[0]?.createdAt ?? ticket.createdAt,
      })),
      topIdeas: ideas,
    };
  }
}
