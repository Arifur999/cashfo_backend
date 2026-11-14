import { Injectable } from '@nestjs/common';
import { BillingCycle, Prisma } from '@prisma/client';
import { isPaidStatus } from '../billing/periods.js';
import { fromPaisa, referralDiscountPaisa, toPaisa } from '../billing/pricing.js';
import { SubscriptionsService } from '../billing/subscriptions.service.js';
import { dhakaDateKey, dhakaMonthStart, dhakaToday } from '../common/dhaka.js';
import { ensureReferralCode } from '../common/referral-code.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import type { ReferralProfileDto } from './dto/referral-pages.dto.js';
import { readSnapshot } from './payout-methods.js';
import { ReferralCommissionsService } from './referral-commissions.service.js';
import { EARNING_SELECT, earningView } from './referral-earnings.service.js';
import { EARNED_STATUSES, FRIEND_STANDINGS, payingFriendWhere, standingWhere } from './referral-friends.js';
import { referralBalances } from './referral-ledger.js';
import { commissionPaisa } from './referral-money.js';
import { expectedRenewalEarnings } from './referral-rules.js';

const money = (paisa: number) => fromPaisa(paisa);
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
const DAY_MS = 24 * 60 * 60 * 1000;
// How many months "Earnings by month" shows.
const CHART_MONTHS = 12;

// The name invited friends see: the member's own choice, or their first name.
export const inviteName = (user: { name: string; referralName: string | null }) => user.referralName ?? firstName(user.name);

@Injectable()
export class ReferralsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly subscriptions: SubscriptionsService,
    private readonly commissions: ReferralCommissionsService,
  ) {}

  // Referrals > Dashboard: the code, whether the member can earn, the
  // program's numbers, the balance by status, earnings by month, the people
  // they brought, who earns them the most and the latest commissions. The
  // older fields at the end keep an older app working until it reloads.
  async getReferralInfo(userId: string) {
    await ensureReferralCode(this.prisma, userId);
    const now = new Date();
    await this.commissions.matureDue(now, userId);
    const { year, month } = dhakaToday();
    const chartStart = dhakaMonthStart(year, month - (CHART_MONTHS - 1));
    const nextMonthStart = dhakaMonthStart(year, month + 1);
    const nextMonthEnd = dhakaMonthStart(year, month + 2);

    const [user, settings, sub, balances, paidPayouts, paidPlans, links, people, chartLines, top, latest, renewing, firstEarned] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { referralCode: true, name: true, referralName: true } }),
      this.settingsService.getReferralSettings(),
      this.subscriptions.ensure(userId),
      referralBalances(this.prisma, userId),
      this.prisma.payoutRequest.findMany({ where: { userId, status: 'PAID' }, orderBy: { paidAt: 'desc' }, take: 1 }),
      this.prisma.subscriptionPlan.findMany({ where: { isActive: true, billingCycle: { not: BillingCycle.FREE } }, orderBy: { displayOrder: 'asc' } }),
      this.prisma.referralLink.count({ where: { userId, deletedAt: null, tag: { not: '' } } }),
      Promise.all(FRIEND_STANDINGS.map((standing) => this.prisma.referral.count({ where: { AND: [{ referrerId: userId }, standingWhere(standing)] } }))),
      this.prisma.referralCommission.findMany({
        where: {
          referrerId: userId,
          status: { in: [...EARNED_STATUSES] },
          OR: [{ payment: { paidAt: { gte: chartStart } } }, { paymentId: null, createdAt: { gte: chartStart } }],
        },
        select: { amount: true, createdAt: true, payment: { select: { paidAt: true } } },
      }),
      this.prisma.referralCommission.groupBy({
        by: ['referralId'],
        where: { referrerId: userId, status: { in: [...EARNED_STATUSES] } },
        _sum: { amount: true },
        _count: { _all: true },
        orderBy: { _sum: { amount: 'desc' } },
        take: 5,
      }),
      this.prisma.referralCommission.findMany({
        where: { referrerId: userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: 5,
        select: EARNING_SELECT,
      }),
      // Paying friends whose plan renews in the next 30 days or next month.
      this.prisma.referral.findMany({
        where: {
          AND: [
            { referrerId: userId },
            payingFriendWhere(),
            {
              referredUser: { subscription: { is: { cancelAtPeriodEnd: false, currentPeriodEnd: { gte: now, lt: new Date(Math.max(now.getTime() + 30 * DAY_MS + 1, nextMonthEnd.getTime())) } } } },
            },
          ],
        },
        select: { referredUser: { select: { subscription: { select: { lockedPrice: true, currentPeriodEnd: true, plan: { select: { price: true } } } } } } },
      }),
      this.prisma.referralCommission.findFirst({
        where: { referrerId: userId, status: { in: [...EARNED_STATUSES] } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true, payment: { select: { paidAt: true } } },
      }),
    ]);

    const onPaidPlan = isPaidStatus(sub.status, sub.plan.billingCycle !== BillingCycle.FREE);
    const lockedReason = !settings.programLive ? 'PROGRAM_OFF' : settings.whoCanEarn === 'PAID_PLAN' && !onPaidPlan ? 'FREE_PLAN' : null;
    const lastPaid = paidPayouts[0] ?? null;

    const byMonth = new Map<string, number>();
    for (const line of chartLines) {
      const key = dhakaDateKey(line.payment?.paidAt ?? line.createdAt).slice(0, 7);
      byMonth.set(key, (byMonth.get(key) ?? 0) + toPaisa(line.amount));
    }
    const months = Array.from({ length: CHART_MONTHS }, (_, i) => {
      const key = dhakaDateKey(dhakaMonthStart(year, month - (CHART_MONTHS - 1) + i)).slice(0, 7);
      return { month: key, amount: money(byMonth.get(key) ?? 0) };
    });

    const topNames = top.length
      ? await this.prisma.referral.findMany({
          where: { id: { in: top.map((t) => t.referralId) } },
          select: { id: true, referredUser: { select: { name: true, subscription: { select: { plan: { select: { name: true } } } } } } },
        })
      : [];
    const nameOf = new Map(topNames.map((r) => [r.id, r.referredUser.name]));
    const planOf = new Map(topNames.map((r) => [r.id, r.referredUser.subscription?.plan.name ?? null]));
    const peopleCount = Object.fromEntries(FRIEND_STANDINGS.map((standing, i) => [standing, people[i]])) as Record<(typeof FRIEND_STANDINGS)[number], number>;
    // What renewals in a window should earn: the next 30 days, and the
    // next calendar month (the chart's dashed "Expected" bar).
    const renewals = renewing.flatMap((r) => {
      const s = r.referredUser.subscription;
      return s ? [{ periodEnd: s.currentPeriodEnd, pricePaisa: toPaisa(s.lockedPrice ?? s.plan.price) }] : [];
    });
    const expectedIn = (from: Date, until: Date) => expectedRenewalEarnings(renewals, from, until, settings.commissionPct);
    const next30 = expectedIn(now, new Date(now.getTime() + 30 * DAY_MS + 1));
    const nextMonth = expectedIn(nextMonthStart, nextMonthEnd);

    return {
      referralCode: user.referralCode,
      // The name friends see on the invite.
      inviteName: inviteName(user),
      canEarn: lockedReason === null,
      lockedReason,
      myPlan: { planId: sub.planId, planName: sub.plan.name, status: sub.status, isPaid: onPaidPlan },
      program: {
        live: settings.programLive,
        whoCanEarn: settings.whoCanEarn,
        commissionPct: settings.commissionPct,
        friendDiscountPct: settings.friendDiscountPct,
        holdDays: settings.holdDays,
        minWithdrawal: money(settings.minWithdrawal * 100),
        fee: money(settings.withdrawalFee * 100),
        payWithinDays: settings.payWithinDays,
        methods: settings.payoutMethods,
        // "What one friend can earn you", per paid plan.
        examples: paidPlans.map((plan) => {
          const price = toPaisa(plan.price);
          const friendPays = price - referralDiscountPaisa(price, settings.friendDiscountPct);
          return {
            planId: plan.id,
            planName: plan.name,
            billingCycle: plan.billingCycle,
            price: money(price),
            friendPays: money(friendPays),
            youEarn: money(commissionPaisa(friendPays, settings.commissionPct)),
            // A renewal is at full price.
            youEarnRenewal: money(commissionPaisa(price, settings.commissionPct)),
          };
        }),
      },
      balances: {
        available: money(balances.availablePaisa),
        onHold: money(balances.onHoldPaisa),
        onHoldNextAt: balances.onHoldNextAt,
        inWithdrawal: money(balances.inWithdrawalPaisa),
        underCheck: money(balances.underCheckPaisa),
        paidOut: money(balances.paidOutPaisa),
        reversed: money(balances.reversedPaisa),
        lifetime: money(balances.lifetimePaisa),
        lastPaidAt: lastPaid?.paidAt ?? null,
        // Older names for the same numbers.
        reserved: money(balances.inWithdrawalPaisa),
        pending: money(balances.onHoldPaisa),
        pendingNextAt: balances.onHoldNextAt,
        totalEarned: money(balances.lifetimePaisa),
      },
      lastPayout: lastPaid && {
        id: lastPaid.id,
        amount: fromPaisa(toPaisa(lastPaid.paidAmount ?? lastPaid.amount)),
        methodType: readSnapshot(lastPaid.methodSnapshot).type,
        paidAt: lastPaid.paidAt,
      },
      // Tagged links besides the main one.
      linkCount: links + 1,
      months,
      people: { total: people.reduce((a, b) => a + b, 0), ...peopleCount },
      // What paying friends' renewals in the next 30 days should earn.
      expectedNext30Days: money(next30.paisa),
      expectedRenewals: next30.count,
      // What renewals due next month should earn ("In December you should
      // earn about ...").
      expectedNextMonth: { month: dhakaDateKey(nextMonthStart).slice(0, 7), amount: money(nextMonth.paisa), renewals: nextMonth.count },
      // When the first commission was earned ("Since August").
      firstEarnedAt: firstEarned ? (firstEarned.payment?.paidAt ?? firstEarned.createdAt) : null,
      // With the plan they are on now and how many of their payments earned.
      topFriends: top.map((t) => ({
        referralId: t.referralId,
        name: nameOf.get(t.referralId) ?? '',
        planName: planOf.get(t.referralId) ?? null,
        payments: t._count._all,
        earned: fromPaisa(toPaisa(t._sum.amount ?? 0)),
      })),
      latest: latest.map(earningView),
      // --- As before (an older app reads these until it reloads) ---
      totalEarned: money(balances.lifetimePaisa),
      pendingEarnings: money(balances.onHoldPaisa),
      availableBalance: money(balances.availablePaisa),
      referralCount: people.reduce((a, b) => a + b, 0),
      pendingCount: 0,
      rewardAmountPerReferral: '0.00',
      recentReferrals: [],
      friends: [],
      friendCounts: { all: 0, bought: 0, notYet: 0, refunded: 0 },
    };
  }

  // GET /api/referrals/invite/:code (no sign-in): who invited the person
  // signing up, for "Khaled invited you". Only the name they chose to show.
  async invite(code: string) {
    const settings = await this.settingsService.getReferralSettings();
    const normalized = code.trim().toUpperCase();
    const referrer = /^[A-Z0-9]{4,16}$/.test(normalized)
      ? await this.prisma.user.findUnique({ where: { referralCode: normalized }, select: { name: true, referralName: true, role: true, status: true } })
      : null;
    const valid = Boolean(referrer && referrer.role === 'USER' && referrer.status === 'ACTIVE');
    const shown = valid ? inviteName(referrer!) : null;
    return {
      valid,
      referrerFirstName: shown,
      referrerName: shown,
      friendDiscountPct: valid && settings.programLive ? settings.friendDiscountPct : 0,
      programLive: settings.programLive,
    };
  }

  // Referrals > Profile & payouts: the name friends see, the email
  // switches, and the contact details the payout desk checks against.
  async profile(userId: string) {
    await ensureReferralCode(this.prisma, userId);
    const [user, first] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          name: true,
          referralName: true,
          email: true,
          emailVerified: true,
          phone: true,
          phoneVerifiedAt: true,
          referralEmailEarned: true,
          referralEmailPayouts: true,
          referralMonthlyStatement: true,
          referralCode: true,
        },
      }),
      this.prisma.referral.findFirst({ where: { referrerId: userId }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    ]);
    return {
      name: user.name,
      referralCode: user.referralCode,
      // When their first friend signed up.
      referringSince: first?.createdAt ?? null,
      referralName: user.referralName,
      inviteName: inviteName(user),
      email: user.email,
      emailVerified: user.emailVerified,
      phone: user.phone,
      phoneVerified: user.phoneVerifiedAt !== null,
      emailEarned: user.referralEmailEarned,
      emailPayouts: user.referralEmailPayouts,
      monthlyStatement: user.referralMonthlyStatement,
    };
  }

  async updateProfile(userId: string, dto: ReferralProfileDto) {
    const data: Prisma.UserUpdateInput = {};
    if (dto.referralName !== undefined) data.referralName = dto.referralName;
    if (dto.emailEarned !== undefined) data.referralEmailEarned = dto.emailEarned;
    if (dto.emailPayouts !== undefined) data.referralEmailPayouts = dto.emailPayouts;
    if (dto.monthlyStatement !== undefined) data.referralMonthlyStatement = dto.monthlyStatement;
    await this.prisma.user.update({ where: { id: userId }, data });
    return this.profile(userId);
  }
}
