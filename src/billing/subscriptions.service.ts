import { Injectable, Logger } from '@nestjs/common';
import { BillingCycle, Prisma, type SubscriptionPlan, type UserSubscription } from '@prisma/client';
import { dhakaDateKey } from '../common/dhaka.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { BillingNotices } from './billing-notices.js';
import { paidPeriod } from './periods.js';
import { endingSoon, graceEndsAt, transitionAt, type SubscriptionClock } from './subscription-rules.js';

type Client = PrismaService | Prisma.TransactionClient;

// The plan new accounts are put on, by slug (UserProvisioningService and
// SubscriptionPlansService use the same name).
export const FREE_PLAN_SLUG = 'free';

// PlanChangeLog.changedBy for changes nobody pressed a button for, and for
// the customer's own (a trial, a cancel).
export const CHANGED_BY_SYSTEM = 'SYSTEM';
export const CHANGED_BY_CUSTOMER = 'CUSTOMER';

// The columns a caller may set along with the plan.
export type SubscriptionFields = Partial<
  Pick<UserSubscription, 'status' | 'trialEndsAt' | 'currentPeriodStart' | 'currentPeriodEnd' | 'cancelAtPeriodEnd' | 'trialUsedAt'> & {
    lockedPrice: Prisma.Decimal | number | null;
  }
>;

export type SubscriptionWithPlan = UserSubscription & { plan: SubscriptionPlan };

// How many subscriptions one housekeeping run looks at.
const SWEEP_BATCH = 200;

export const clockOf = (sub: SubscriptionWithPlan): SubscriptionClock => ({
  status: sub.status,
  planIsPaid: sub.plan.billingCycle !== BillingCycle.FREE,
  trialEndsAt: sub.trialEndsAt,
  currentPeriodEnd: sub.currentPeriodEnd,
  cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
});

// A customer's plan (UserSubscription), and the one way it changes:
// applyPlan(), which also keeps their workspaces' Business.planId in step
// (the mirror everything older reads) and writes PlanChangeLog.
@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly notices: BillingNotices,
  ) {}

  async freePlan(client: Client = this.prisma): Promise<SubscriptionPlan | null> {
    return (
      (await client.subscriptionPlan.findUnique({ where: { slug: FREE_PLAN_SLUG } })) ??
      (await client.subscriptionPlan.findFirst({ where: { billingCycle: BillingCycle.FREE }, orderBy: { displayOrder: 'asc' } }))
    );
  }

  // The customer's subscription, made on first use for an account that
  // predates it: on their default workspace's plan, or the free plan.
  async ensure(userId: string, client: Client = this.prisma): Promise<SubscriptionWithPlan> {
    const existing = await client.userSubscription.findUnique({ where: { userId }, include: { plan: true } });
    if (existing) return existing;
    const workspace = await client.business.findFirst({ where: { ownerId: userId, isDefault: true, deletedAt: null }, select: { planId: true } });
    const planId = workspace?.planId ?? (await this.freePlan(client))?.id;
    if (!planId) throw new Error('No free plan exists to put the account on');
    return client.userSubscription.upsert({ where: { userId }, create: { userId, planId, status: 'ACTIVE' }, update: {}, include: { plan: true } });
  }

  // Puts the customer on `planId` with the given fields, mirrors it onto
  // every workspace of theirs that carries a plan (not group ones), and
  // logs the change.
  async applyPlan(
    tx: Prisma.TransactionClient,
    userId: string,
    planId: string,
    options: { changedBy: string; reason?: string | null; fields?: SubscriptionFields },
  ): Promise<SubscriptionWithPlan> {
    const before = await tx.userSubscription.findUnique({ where: { userId }, select: { planId: true } });
    const fromPlanId =
      before?.planId ??
      (await tx.business.findFirst({ where: { ownerId: userId, isDefault: true, deletedAt: null }, select: { planId: true } }))?.planId ??
      null;
    const fields = options.fields ?? {};
    const sub = await tx.userSubscription.upsert({
      where: { userId },
      create: { userId, planId, status: fields.status ?? 'ACTIVE', ...fields },
      update: { planId, ...fields },
      include: { plan: true },
    });
    await tx.business.updateMany({ where: { ownerId: userId, deletedAt: null, type: { not: 'GROUP' } }, data: { planId } });
    if (fromPlanId !== planId) {
      await tx.planChangeLog.create({ data: { userId, fromPlanId, toPlanId: planId, changedBy: options.changedBy, reason: options.reason ?? null } });
    }
    return sub;
  }

  // Back on the free plan, with the reason kept in the status.
  async dropToFree(tx: Prisma.TransactionClient, userId: string, status: 'EXPIRED' | 'CANCELLED', changedBy: string, reason: string) {
    const free = await this.freePlan(tx);
    if (!free) throw new Error('No free plan exists to put the account on');
    return this.applyPlan(tx, userId, free.id, {
      changedBy,
      reason,
      fields: { status, currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, trialEndsAt: null, lockedPrice: null },
    });
  }

  // A confirmed payment's plan and period: the plan becomes ACTIVE for one
  // cycle from the payment (or from the running period's end, for the
  // same plan paid again early).
  async activateFromPayment(
    tx: Prisma.TransactionClient,
    payment: { userId: string; planId: string; listPrice: Prisma.Decimal | null },
    plan: SubscriptionPlan,
    paidAt: Date,
    changedBy: string,
  ): Promise<{ subscription: SubscriptionWithPlan; periodStart: Date; periodEnd: Date | null }> {
    const current = await tx.userSubscription.findUnique({ where: { userId: payment.userId }, include: { plan: true } });
    const period = paidPeriod(
      current && {
        planId: current.planId,
        status: current.status,
        currentPeriodEnd: current.currentPeriodEnd,
        planIsPaid: current.plan.billingCycle !== BillingCycle.FREE,
      },
      plan.id,
      plan.billingCycle,
      paidAt,
    );
    const subscription = await this.applyPlan(tx, payment.userId, plan.id, {
      changedBy,
      reason: 'payment',
      fields: {
        status: 'ACTIVE',
        currentPeriodStart: period.start,
        currentPeriodEnd: period.end,
        cancelAtPeriodEnd: false,
        trialEndsAt: null,
        lockedPrice: payment.listPrice ?? plan.price,
      },
    });
    return { subscription, periodStart: period.start, periodEnd: period.end };
  }

  // --- Expiry: lazily for one customer when their billing page is read,
  // and for everyone by the housekeeping timer. ---

  async sweepUser(userId: string, now = new Date()) {
    await this.expirePendingPayments(now, userId);
    const sub = await this.prisma.userSubscription.findUnique({ where: { userId }, include: { plan: true } });
    if (sub) await this.advance(sub, now);
  }

  // Subscriptions that may have something due: a trial or a period ending
  // within the warning window, or already past it.
  async sweepAll(now = new Date()) {
    const horizon = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const subs = await this.prisma.userSubscription.findMany({
      where: {
        OR: [
          { status: 'TRIALING', trialEndsAt: { lte: horizon } },
          { status: { in: ['ACTIVE', 'PAST_DUE'] }, currentPeriodEnd: { lte: horizon } },
        ],
      },
      include: { plan: true },
      orderBy: { updatedAt: 'asc' },
      take: SWEEP_BATCH,
    });
    for (const sub of subs) {
      try {
        await this.advance(sub, now);
      } catch (error) {
        this.logger.warn(`Plan expiry for subscription ${sub.id} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  // Unpaid checkouts past their time fail as "expired". One whose money
  // the customer sent has no end (expiresAt null); submittedAt: null is a
  // second guard.
  async expirePendingPayments(now = new Date(), userId?: string) {
    const lapsed = await this.prisma.payment.findMany({
      where: { status: 'PENDING', expiresAt: { lte: now }, submittedAt: null, ...(userId && { userId }) },
      select: { id: true, userId: true, amount: true, plan: { select: { name: true } } },
      take: SWEEP_BATCH,
    });
    for (const payment of lapsed) {
      const { count } = await this.prisma.payment.updateMany({
        where: { id: payment.id, status: 'PENDING' },
        data: { status: 'FAILED', failureReason: 'expired' },
      });
      if (count === 0 || !payment.userId) continue;
      await this.notices.bell(payment.userId, {
        key: `payment:${payment.id}:expired`,
        data: { event: 'PAYMENT_EXPIRED', paymentId: payment.id, planName: payment.plan.name, amount: Number(payment.amount).toFixed(2) },
      });
    }
  }

  // One subscription's next step, if it has one, and its notices. The move
  // is claimed on the row as it was read, so the timer and a page read
  // racing each other make it once.
  private async advance(sub: SubscriptionWithPlan, now: Date) {
    const { billingGraceDays } = await this.settingsService.getCached();
    const clock = clockOf(sub);
    const step = transitionAt(clock, now, billingGraceDays);

    if (!step) {
      const soon = endingSoon(clock, now);
      if (soon) {
        await this.notices.plan(
          sub.userId,
          {
            key: `plan:${sub.id}:ending:${dhakaDateKey(soon.endsAt)}`,
            data: {
              event: 'PLAN_ENDING',
              planName: sub.plan.name,
              endsAt: soon.endsAt.toISOString(),
              trial: soon.trial ? 1 : 0,
              cancelling: sub.cancelAtPeriodEnd ? 1 : 0,
            },
          },
          sub.cancelAtPeriodEnd ? null : { kind: 'ENDING', planName: sub.plan.name, trial: soon.trial, date: soon.endsAt },
        );
      }
      return;
    }

    const claim = { id: sub.id, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd, trialEndsAt: sub.trialEndsAt, planId: sub.planId };
    if (step.to === 'PAST_DUE') {
      const { count } = await this.prisma.userSubscription.updateMany({ where: claim, data: { status: 'PAST_DUE' } });
      if (count === 0 || !sub.currentPeriodEnd) return;
      const graceEnd = graceEndsAt(sub.currentPeriodEnd, billingGraceDays);
      await this.notices.plan(
        sub.userId,
        {
          key: `plan:${sub.id}:past-due:${dhakaDateKey(sub.currentPeriodEnd)}`,
          data: { event: 'PLAN_PAST_DUE', planName: sub.plan.name, graceEndsAt: graceEnd.toISOString() },
        },
        null,
      );
      return;
    }

    const trial = sub.status === 'TRIALING';
    const endedAt = (trial ? sub.trialEndsAt : sub.currentPeriodEnd) ?? now;
    const dropped = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.userSubscription.updateMany({ where: claim, data: { status: step.to } });
      if (count === 0) return false;
      await this.dropToFree(tx, sub.userId, step.to, CHANGED_BY_SYSTEM, trial ? 'trial_ended' : step.to === 'CANCELLED' ? 'cancelled' : 'expired');
      return true;
    });
    if (!dropped) return;
    await this.notices.plan(
      sub.userId,
      {
        key: `plan:${sub.id}:ended:${dhakaDateKey(endedAt)}`,
        data: { event: 'PLAN_ENDED', planName: sub.plan.name, endedAt: endedAt.toISOString(), trial: trial ? 1 : 0, reason: step.to },
      },
      { kind: 'ENDED', planName: sub.plan.name, trial, date: endedAt },
    );
  }
}
