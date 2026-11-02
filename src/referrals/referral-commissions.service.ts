import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { BillingCycle, Prisma, type Payment } from '@prisma/client';
import { BillingHooks, type AfterCommit } from '../billing/billing-hooks.js';
import { isPaidStatus } from '../billing/periods.js';
import { fromPaisa, toPaisa } from '../billing/pricing.js';
import { SubscriptionsService } from '../billing/subscriptions.service.js';
import { HousekeepingScheduler } from '../housekeeping/housekeeping.scheduler.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { money, ReferralNotices } from './referral-notices.js';
import { friendPaidOutcome, friendRefundedOutcome, isBlockedSignup } from './referral-rules.js';

const FIVE_MINUTES = 5 * 60 * 1000;
// How many commissions one maturing run moves.
const MATURE_BATCH = 200;

// Takes the referrer's lock inside the payment's own transaction: the same
// key (and hashtext) as TransactionsService.withLocks(['referrals:<id>']),
// so a commission never changes under a withdrawal being made or paid.
const lockReferrer = (tx: Prisma.TransactionClient, referrerId: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`referrals:${referrerId}`}))`;

// Commissions: one for every confirmed payment of an invited friend's
// (renewals too), cut back or reversed when that payment is refunded
// inside its window, and moved to AVAILABLE when the window ends. The
// first two run inside billing's own transaction (BillingHooks); maturing
// runs on every referral read and on the housekeeping timer.
@Injectable()
export class ReferralCommissionsService implements OnModuleInit {
  private readonly logger = new Logger(ReferralCommissionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly subscriptions: SubscriptionsService,
    private readonly hooks: BillingHooks,
    private readonly housekeeping: HousekeepingScheduler,
    private readonly notices: ReferralNotices,
  ) {}

  onModuleInit() {
    this.hooks.onPaid((payment, tx) => this.onFriendPaid(payment, tx));
    this.hooks.onRefunded((payment, tx, refund) => this.onFriendRefunded(payment, tx, refund));
    this.housekeeping.register({ name: 'referral-commission-maturing', everyMs: FIVE_MINUTES, run: (now) => this.matureDue(now) });
  }

  // A confirmed payment of an invited friend's: the referrer's share, or a
  // CANCELLED line saying why there is none. A sign-up that never counted
  // (self-referral, monthly limit) earns nothing at all. The email waits
  // for the commit.
  async onFriendPaid(payment: Payment, tx: Prisma.TransactionClient): Promise<AfterCommit | void> {
    if (!payment.userId) return;
    const referral = await tx.referral.findUnique({
      where: { referredUserId: payment.userId },
      select: { id: true, referrerId: true, status: true, cancelReason: true, referredUser: { select: { name: true } } },
    });
    if (!referral || isBlockedSignup(referral)) return;
    await lockReferrer(tx, referral.referrerId);
    if (await tx.referralCommission.findUnique({ where: { paymentId: payment.id }, select: { id: true } })) return;

    const [settings, referrerSub, plan, earlier] = await Promise.all([
      this.settingsService.getReferralSettings(tx),
      this.subscriptions.ensure(referral.referrerId, tx),
      tx.subscriptionPlan.findUnique({ where: { id: payment.planId }, select: { name: true } }),
      tx.referralCommission.count({ where: { referralId: referral.id, kind: { not: 'BONUS' } } }),
    ]);
    const now = new Date();
    const outcome = friendPaidOutcome({
      programLive: settings.programLive,
      whoCanEarn: settings.whoCanEarn,
      referrerOnPaidPlan: isPaidStatus(referrerSub.status, referrerSub.plan.billingCycle !== BillingCycle.FREE),
      paidPaisa: toPaisa(payment.amount),
      commissionPct: settings.commissionPct,
      holdDays: settings.holdDays,
      paidAt: payment.paidAt ?? now,
      now,
    });
    if (outcome.commissionPaisa <= 0) return;

    const renewal = earlier > 0;
    const commission = await tx.referralCommission.create({
      data: {
        referralId: referral.id,
        referrerId: referral.referrerId,
        paymentId: payment.id,
        kind: renewal ? 'RENEWAL' : 'FIRST',
        paidAmount: payment.amount,
        rate: new Prisma.Decimal(settings.commissionPct),
        amount: new Prisma.Decimal(fromPaisa(outcome.commissionPaisa)),
        status: outcome.status,
        availableAt: outcome.availableAt,
        ...(outcome.status === 'CANCELLED' && { cancelReason: outcome.reason, endedAt: now }),
      },
    });

    const base = {
      commissionId: commission.id,
      referralId: referral.id,
      friendName: referral.referredUser.name,
      planName: plan?.name ?? null,
      amount: money(commission.amount),
      kind: commission.kind,
    };
    if (outcome.status === 'CANCELLED') {
      // Worth telling: they missed it by not being on a paid plan.
      if (outcome.reason === 'REFERRER_NOT_ON_PAID_PLAN') {
        await this.notices.bell(
          referral.referrerId,
          'REFERRAL',
          `commission:${commission.id}:missed`,
          { event: 'COMMISSION_MISSED', ...base, reason: outcome.reason },
          tx,
        );
      }
      return;
    }
    const email = await this.notices.commissionEarned(
      referral.referrerId,
      { id: commission.id, amount: commission.amount, availableAt: commission.availableAt, renewal },
      referral.referredUser.name,
      { ...base, paidAmount: money(payment.amount), availableAt: commission.availableAt.toISOString() },
      tx,
    );
    if (outcome.status === 'AVAILABLE') {
      await this.notices.bell(referral.referrerId, 'REFERRAL', `commission:${commission.id}:available`, { event: 'COMMISSION_AVAILABLE', ...base }, tx);
    }
    return email;
  }

  // A refund of a payment that earned a commission.
  async onFriendRefunded(payment: Payment, tx: Prisma.TransactionClient, refund: { amount: number; full: boolean }) {
    const found = await tx.referralCommission.findUnique({ where: { paymentId: payment.id }, select: { id: true, referrerId: true } });
    if (!found) return;
    await lockReferrer(tx, found.referrerId);
    const commission = await tx.referralCommission.findUniqueOrThrow({
      where: { id: found.id },
      include: { referral: { select: { referredUser: { select: { name: true } } } } },
    });
    const settings = await this.settingsService.getReferralSettings(tx);
    const outcome = friendRefundedOutcome({
      status: commission.status,
      availableAt: commission.availableAt,
      cancelOnRefund: settings.cancelOnRefund,
      paidPaisa: toPaisa(commission.paidAmount),
      refundPaisa: Math.round(refund.amount * 100),
      full: refund.full,
      commissionRatePct: Number(commission.rate),
      now: new Date(),
    });
    if (!outcome) return;
    if (outcome.action === 'REDUCE') {
      await tx.referralCommission.updateMany({
        where: { id: commission.id, status: 'ON_HOLD' },
        data: { amount: new Prisma.Decimal(fromPaisa(outcome.commissionPaisa)) },
      });
      return;
    }
    const { count } = await tx.referralCommission.updateMany({
      where: { id: commission.id, status: 'ON_HOLD' },
      data: { status: 'REVERSED', cancelReason: 'FRIEND_REFUNDED', endedAt: new Date() },
    });
    if (count === 0) return;
    await this.notices.bell(
      commission.referrerId,
      'REFERRAL',
      `commission:${commission.id}:cancelled`,
      {
        event: 'COMMISSION_CANCELLED',
        commissionId: commission.id,
        referralId: commission.referralId,
        friendName: commission.referral.referredUser.name,
        amount: money(commission.amount),
        reason: 'FRIEND_REFUNDED',
      },
      tx,
    );
  }

  // ON_HOLD commissions whose window is over become AVAILABLE: for one
  // member when their pages are read, for everyone on the timer. Each move
  // is claimed on the row, so a race makes it once.
  async matureDue(now = new Date(), referrerId?: string) {
    const due = await this.prisma.referralCommission.findMany({
      where: { status: 'ON_HOLD', availableAt: { lte: now }, ...(referrerId && { referrerId }) },
      select: { id: true, referrerId: true, referralId: true, kind: true, amount: true, referral: { select: { referredUser: { select: { name: true } } } } },
      orderBy: { availableAt: 'asc' },
      take: MATURE_BATCH,
    });
    for (const row of due) {
      try {
        const { count } = await this.prisma.referralCommission.updateMany({ where: { id: row.id, status: 'ON_HOLD' }, data: { status: 'AVAILABLE' } });
        if (count === 0) continue;
        await this.notices.bell(row.referrerId, 'REFERRAL', `commission:${row.id}:available`, {
          event: 'COMMISSION_AVAILABLE',
          commissionId: row.id,
          referralId: row.referralId,
          friendName: row.referral.referredUser.name,
          amount: money(row.amount),
          kind: row.kind,
        });
      } catch (error) {
        this.logger.warn(`Maturing commission ${row.id} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}
