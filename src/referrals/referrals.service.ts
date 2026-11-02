import { BadRequestException, Injectable } from '@nestjs/common';
import { BillingCycle, Prisma } from '@prisma/client';
import { isPaidStatus } from '../billing/periods.js';
import { fromPaisa, referralDiscountPaisa, toPaisa } from '../billing/pricing.js';
import { SubscriptionsService } from '../billing/subscriptions.service.js';
import { dhakaDateKey } from '../common/dhaka.js';
import { ensureReferralCode } from '../common/referral-code.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { TransactionsService } from '../transactions/transactions.service.js';
import { readSnapshot } from './payout-methods.js';
import { ReferralCommissionsService } from './referral-commissions.service.js';
import { findIncomeTarget, memberLedger, requireOrCreateReferralBonusAccount, toEntry } from './referral-ledger.js';
import { allocateFifo, commissionPaisa, isoWeekKey, legacyStatusOf } from './referral-money.js';
import { ReferralNotices } from './referral-notices.js';
import { friendFilterOf } from './referral-rules.js';

const money = (paisa: number) => fromPaisa(paisa);
const decimalMoney = (value: { toString(): string } | null | undefined) => (value == null ? null : fromPaisa(toPaisa(value)));
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

@Injectable()
export class ReferralsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly transactionsService: TransactionsService,
    private readonly subscriptions: SubscriptionsService,
    private readonly commissions: ReferralCommissionsService,
    private readonly notices: ReferralNotices,
  ) {}

  // The member's Referral Program page: their code, whether they can earn,
  // the program's numbers, the balance and every friend. The older fields
  // (totalEarned ... recentReferrals) keep their meaning for older apps.
  async getReferralInfo(userId: string) {
    await ensureReferralCode(this.prisma, userId);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const now = new Date();
    await this.commissions.matureDue(now, userId);

    const [settings, sub, ledger, referrals, paidPayouts, paidPlans, legacy] = await Promise.all([
      this.settingsService.getReferralSettings(),
      this.subscriptions.ensure(userId),
      memberLedger(this.prisma, userId),
      this.prisma.referral.findMany({
        where: { referrerId: userId },
        orderBy: { createdAt: 'desc' },
        include: {
          referredUser: { select: { name: true, createdAt: true, subscription: { select: { plan: { select: { name: true } } } } } },
          payment: { select: { paidAt: true, status: true, plan: { select: { name: true } } } },
        },
      }),
      this.prisma.payoutRequest.findMany({ where: { userId, status: 'PAID' }, orderBy: { paidAt: 'desc' }, take: 1 }),
      this.prisma.subscriptionPlan.findMany({ where: { isActive: true, billingCycle: { not: BillingCycle.FREE } }, orderBy: { displayOrder: 'asc' } }),
      this.settingsService.get(),
    ]);

    const onPaidPlan = isPaidStatus(sub.status, sub.plan.billingCycle !== BillingCycle.FREE);
    const lockedReason = !settings.programLive ? 'PROGRAM_OFF' : settings.whoCanEarn === 'PAID_PLAN' && !onPaidPlan ? 'FREE_PLAN' : null;
    const { balances } = ledger;
    const lastPaid = paidPayouts[0] ?? null;

    const friends = referrals.map((r) => {
      const entry = toEntry(r);
      return {
        id: r.id,
        name: r.referredUser.name,
        joinedAt: r.createdAt,
        kind: r.kind,
        status: r.status,
        // Which tab it is under: BOUGHT, NOT_YET, REFUNDED, or OTHER (an old
        // sign-up bonus, or a sign-up that didn't count).
        filter: friendFilterOf(r),
        // The plan the friend bought (their first payment), and the one
        // they are on now ("On the Free plan").
        planName: r.payment?.plan.name ?? null,
        currentPlanName: r.referredUser.subscription?.plan.name ?? null,
        boughtAt: r.payment?.paidAt ?? null,
        paidAmount: decimalMoney(r.paidAmount),
        commissionAmount: r.status === 'JOINED' ? null : money(entry.commissionPaisa),
        paidOutAmount: money(entry.paidOutPaisa),
        availableAt: r.availableAt,
        cancelReason: r.cancelReason,
        cancelledAt: r.cancelledAt,
        paidOutAt: r.paidOutAt,
        refunded: r.payment?.status === 'REFUNDED',
      };
    });
    const count = (filter: string) => friends.filter((f) => f.filter === filter).length;

    return {
      referralCode: user.referralCode,
      // --- As before (older apps read these) ---
      totalEarned: money(balances.totalEarnedPaisa),
      pendingEarnings: money(balances.pendingPaisa),
      availableBalance: money(balances.availablePaisa),
      referralCount: referrals.length,
      pendingCount: referrals.filter((r) => r.status === 'PENDING').length,
      rewardAmountPerReferral: new Prisma.Decimal(legacy.referralRewardAmount).toFixed(2),
      recentReferrals: referrals.map((r) => ({
        id: r.id,
        name: r.referredUser.name,
        status: legacyStatusOf(r.status),
        rewardAmount: money(toEntry(r).commissionPaisa),
        createdAt: r.createdAt.toISOString(),
        confirmedAt: (r.status === 'AVAILABLE' || r.status === 'PAID_OUT' ? (r.availableAt ?? r.confirmedAt) : null)?.toISOString() ?? null,
        withdrawnAt: (r.paidOutAt ?? r.withdrawnAt)?.toISOString() ?? null,
      })),
      // --- The commission program ---
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
            price: money(price),
            friendPays: money(friendPays),
            youEarn: money(commissionPaisa(friendPays, settings.commissionPct)),
          };
        }),
      },
      balances: {
        available: money(balances.availablePaisa),
        // Set aside by requests waiting to be paid.
        reserved: money(balances.reservedPaisa),
        pending: money(balances.pendingPaisa),
        pendingNextAt: balances.pendingNextAt,
        totalEarned: money(balances.totalEarnedPaisa),
        paidOut: money(balances.paidOutPaisa),
        lastPaidAt: lastPaid?.paidAt ?? null,
      },
      lastPayout: lastPaid && {
        id: lastPaid.id,
        amount: decimalMoney(lastPaid.paidAmount ?? lastPaid.amount),
        methodType: readSnapshot(lastPaid.methodSnapshot).type,
        paidAt: lastPaid.paidAt,
      },
      friends,
      friendCounts: { all: friends.length, bought: count('BOUGHT'), notYet: count('NOT_YET'), refunded: count('REFUNDED') },
    };
  }

  // The old instant withdrawal (POST /api/businesses/:id/referrals/withdraw):
  // old ৳ 100 sign-up bonuses that are available are booked as Referral
  // income into one of the member's wallets, as before. Commissions are
  // cashed out through payout requests instead. Under the member's lock, so
  // a double click or a payout request being made waits its turn.
  async withdraw(userId: string, businessId: string, accountId: string, actorUserId: string) {
    return this.transactionsService.withLocks([`referrals:${userId}`, `referral-bonus:${businessId}`], async (tx) => {
      const { rows, entries, balances } = await memberLedger(tx, userId);
      const bonusIds = new Set(rows.filter((r) => r.kind === 'SIGNUP_BONUS').map((r) => r.id));
      const bonuses = entries.filter((e) => bonusIds.has(e.id));
      const bonusLeft = bonuses.filter((e) => e.status === 'AVAILABLE').reduce((sum, e) => sum + Math.max(0, e.commissionPaisa - e.paidOutPaisa), 0);
      const amountPaisa = Math.min(bonusLeft, balances.availablePaisa);
      const allocation = amountPaisa > 0 ? allocateFifo(bonuses, amountPaisa) : null;
      if (!allocation) throw new BadRequestException('No available balance to withdraw.');

      const target = await findIncomeTarget(tx, userId, businessId, accountId);
      if ('problem' in target) throw new BadRequestException(target.problem);
      const incomeAccount = await requireOrCreateReferralBonusAccount(tx, businessId);
      const amount = amountPaisa / 100;

      await this.transactionsService.createTransaction(
        businessId,
        {
          transactionType: 'INCOME',
          // Today in Dhaka -- UTC's date is still yesterday before 6am here.
          transactionDate: dhakaDateKey(new Date()),
          description: 'Referral Program withdrawal',
          entries: [
            { accountId: target.account.id, entryType: 'DEBIT', amount, categoryId: 'Referral Bonus' },
            { accountId: incomeAccount.id, entryType: 'CREDIT', amount },
          ],
        },
        actorUserId,
        tx,
      );

      const now = new Date();
      for (const part of allocation) {
        await tx.referral.update({
          where: { id: part.referralId },
          data: {
            paidOutAmount: { increment: new Prisma.Decimal(fromPaisa(part.paisa)) },
            ...(part.closes && { status: 'PAID_OUT', paidOutAt: now, withdrawnAt: now }),
          },
        });
      }
      return { withdrawnAmount: fromPaisa(amountPaisa) };
    });
  }

  // GET /api/referrals/invite/:code (no sign-in): who invited the person
  // signing up, for "Khaled Mahmud invited you".
  async invite(code: string) {
    const settings = await this.settingsService.getReferralSettings();
    const normalized = code.trim().toUpperCase();
    const referrer = /^[A-Z0-9]{4,16}$/.test(normalized)
      ? await this.prisma.user.findUnique({ where: { referralCode: normalized }, select: { name: true, role: true, status: true } })
      : null;
    const valid = Boolean(referrer && referrer.role === 'USER' && referrer.status === 'ACTIVE');
    return {
      valid,
      referrerFirstName: valid ? firstName(referrer!.name) : null,
      referrerName: valid ? referrer!.name : null,
      friendDiscountPct: valid && settings.programLive ? settings.friendDiscountPct : 0,
      programLive: settings.programLive,
    };
  }

  // "Send a reminder" to friends who joined but haven't bought: a row in
  // their bell, at most once a week each.
  async remind(userId: string, referralIds: string[]) {
    const settings = await this.settingsService.getReferralSettings();
    if (!settings.programLive) throw new BadRequestException('The Referral Program is paused');
    const [me, rows] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } }),
      this.prisma.referral.findMany({ where: { id: { in: referralIds }, referrerId: userId, status: 'JOINED' }, select: { id: true, referredUserId: true } }),
    ]);
    const week = isoWeekKey(new Date());
    let sent = 0;
    for (const row of rows) {
      const fresh = await this.notices.bell(row.referredUserId, 'REFERRAL', `referral-nudge:${row.id}:${week}`, {
        event: 'INVITE_REMINDER',
        referrerFirstName: firstName(me.name),
        friendDiscountPct: settings.friendDiscountPct,
      });
      if (fresh) sent++;
    }
    return { sent, skipped: referralIds.length - sent };
  }
}
