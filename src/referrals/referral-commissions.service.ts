import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { BillingCycle, Prisma, type Payment } from '@prisma/client';
import { BillingHooks } from '../billing/billing-hooks.js';
import { isPaidStatus } from '../billing/periods.js';
import { fromPaisa, toPaisa } from '../billing/pricing.js';
import { SubscriptionsService } from '../billing/subscriptions.service.js';
import { HousekeepingScheduler } from '../housekeeping/housekeeping.scheduler.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { money, ReferralNotices } from './referral-notices.js';
import { friendPaidOutcome, friendRefundedOutcome } from './referral-rules.js';

const FIVE_MINUTES = 5 * 60 * 1000;
// How many commissions one maturing run moves.
const MATURE_BATCH = 200;

// Takes the referrer's lock inside the payment's own transaction: the same
// key (and hashtext) as TransactionsService.withLocks(['referrals:<id>']),
// so a commission never changes under a withdrawal being counted.
const lockReferrer = (tx: Prisma.TransactionClient, referrerId: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`referrals:${referrerId}`}))`;

// Commissions: made when an invited friend's first payment is confirmed,
// cut back or cancelled when it is refunded inside the window, and moved
// to AVAILABLE when the window ends. The first two run inside billing's
// own transaction (BillingHooks); maturing runs on every referral read and
// on the housekeeping timer.
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

  // The friend's first confirmed payment. A referral that isn't JOINED
  // (an old sign-up bonus, one already decided, or a later payment) is
  // left alone.
  async onFriendPaid(payment: Payment, tx: Prisma.TransactionClient) {
    if (!payment.userId) return;
    const found = await tx.referral.findUnique({ where: { referredUserId: payment.userId }, select: { id: true, referrerId: true, status: true } });
    if (!found || found.status !== 'JOINED') return;
    await lockReferrer(tx, found.referrerId);
    const referral = await tx.referral.findUniqueOrThrow({ where: { id: found.id }, include: { referredUser: { select: { name: true } } } });
    if (referral.status !== 'JOINED') return;

    const [settings, referrerSub, plan] = await Promise.all([
      this.settingsService.getReferralSettings(tx),
      this.subscriptions.ensure(referral.referrerId, tx),
      tx.subscriptionPlan.findUnique({ where: { id: payment.planId }, select: { name: true } }),
    ]);
    const now = new Date();
    const paidAt = payment.paidAt ?? now;
    const outcome = friendPaidOutcome({
      programLive: settings.programLive,
      whoCanEarn: settings.whoCanEarn,
      referrerOnPaidPlan: isPaidStatus(referrerSub.status, referrerSub.plan.billingCycle !== BillingCycle.FREE),
      paidPaisa: toPaisa(payment.amount),
      commissionPct: settings.commissionPct,
      holdDays: settings.holdDays,
      paidAt,
      now,
    });

    const common = {
      paymentId: payment.id,
      paidAmount: payment.amount,
      commissionRate: new Prisma.Decimal(settings.commissionPct),
      commissionAmount: new Prisma.Decimal(fromPaisa(outcome.commissionPaisa)),
    };
    const data: Prisma.ReferralUncheckedUpdateManyInput =
      outcome.status === 'CANCELLED'
        ? { ...common, status: 'CANCELLED', cancelledAt: now, cancelReason: outcome.reason }
        : { ...common, status: outcome.status, availableAt: outcome.availableAt };
    const { count } = await tx.referral.updateMany({ where: { id: referral.id, status: 'JOINED' }, data });
    if (count === 0) return;

    const base = { referralId: referral.id, friendName: referral.referredUser.name, planName: plan?.name ?? null, amount: fromPaisa(outcome.commissionPaisa) };
    if (outcome.status === 'CANCELLED') {
      // Worth telling: they missed it by not being on a paid plan.
      if (outcome.reason === 'REFERRER_NOT_ON_PAID_PLAN') {
        await this.notices.bell(
          referral.referrerId,
          'REFERRAL',
          `referral:${referral.id}:missed`,
          { event: 'COMMISSION_MISSED', ...base, reason: outcome.reason },
          tx,
        );
      }
      return;
    }
    await this.notices.bell(
      referral.referrerId,
      'REFERRAL',
      `referral:${referral.id}:pending`,
      { event: 'COMMISSION_PENDING', ...base, paidAmount: money(payment.amount), availableAt: outcome.availableAt.toISOString() },
      tx,
    );
    if (outcome.status === 'AVAILABLE') {
      await this.notices.bell(referral.referrerId, 'REFERRAL', `referral:${referral.id}:available`, { event: 'COMMISSION_AVAILABLE', ...base }, tx);
    }
  }

  // A refund of the payment that earned a commission.
  async onFriendRefunded(payment: Payment, tx: Prisma.TransactionClient, refund: { amount: number; full: boolean }) {
    const found = await tx.referral.findUnique({ where: { paymentId: payment.id }, select: { id: true, referrerId: true } });
    if (!found) return;
    await lockReferrer(tx, found.referrerId);
    const referral = await tx.referral.findUniqueOrThrow({ where: { id: found.id }, include: { referredUser: { select: { name: true } } } });
    const settings = await this.settingsService.getReferralSettings(tx);
    const outcome = friendRefundedOutcome({
      status: referral.status,
      availableAt: referral.availableAt,
      cancelOnRefund: settings.cancelOnRefund,
      paidPaisa: toPaisa(referral.paidAmount ?? payment.amount),
      refundPaisa: Math.round(refund.amount * 100),
      full: refund.full,
      commissionRatePct: Number(referral.commissionRate ?? settings.commissionPct),
      now: new Date(),
    });
    if (!outcome) return;
    if (outcome.action === 'REDUCE') {
      await tx.referral.updateMany({
        where: { id: referral.id, status: 'PENDING' },
        data: { commissionAmount: new Prisma.Decimal(fromPaisa(outcome.commissionPaisa)) },
      });
      return;
    }
    const { count } = await tx.referral.updateMany({
      where: { id: referral.id, status: 'PENDING' },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'FRIEND_REFUNDED' },
    });
    if (count === 0) return;
    await this.notices.bell(
      referral.referrerId,
      'REFERRAL',
      `referral:${referral.id}:cancelled`,
      {
        event: 'COMMISSION_CANCELLED',
        referralId: referral.id,
        friendName: referral.referredUser.name,
        amount: money(referral.commissionAmount ?? 0),
        reason: 'FRIEND_REFUNDED',
      },
      tx,
    );
  }

  // PENDING commissions (and old sign-up bonuses) whose window is over
  // become AVAILABLE: for one member when their page is read, for everyone
  // on the timer. Each move is claimed on the row, so a race makes it once.
  async matureDue(now = new Date(), referrerId?: string) {
    const due = await this.prisma.referral.findMany({
      where: { status: 'PENDING', availableAt: { lte: now }, ...(referrerId && { referrerId }) },
      select: { id: true, referrerId: true, kind: true, commissionAmount: true, rewardAmount: true, referredUser: { select: { name: true } } },
      orderBy: { availableAt: 'asc' },
      take: MATURE_BATCH,
    });
    for (const row of due) {
      try {
        const { count } = await this.prisma.referral.updateMany({ where: { id: row.id, status: 'PENDING' }, data: { status: 'AVAILABLE', confirmedAt: now } });
        if (count === 0) continue;
        await this.notices.bell(row.referrerId, 'REFERRAL', `referral:${row.id}:available`, {
          event: 'COMMISSION_AVAILABLE',
          referralId: row.id,
          friendName: row.referredUser.name,
          amount: money(row.commissionAmount ?? row.rewardAmount),
          kind: row.kind,
        });
      } catch (error) {
        this.logger.warn(`Maturing referral ${row.id} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}
