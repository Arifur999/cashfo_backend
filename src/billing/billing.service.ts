import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BillingCycle, PaymentStatus, type Coupon, type SubscriptionPlan } from '@prisma/client';
import { dhakaDateKey, dhakaMonthStart, dhakaToday } from '../common/dhaka.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { displayPaymentId } from './billing-text.js';
import type { CheckoutDto, CouponPreviewDto } from './dto/checkout.dto.js';
import { PaymentGateways } from './gateways/payment-gateways.js';
import { isPaidStatus, purposeFor } from './periods.js';
import { couponDiscountPaisa, couponProblem, fromPaisa, priceWith, referralDiscountPaisa, toPaisa, type CouponProblem, type Price } from './pricing.js';
import { graceEndsAt } from './subscription-rules.js';
import { CHANGED_BY_CUSTOMER, SubscriptionsService, type SubscriptionWithPlan } from './subscriptions.service.js';
import { leftOf, planLimits } from './usage.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const COUPON_MESSAGES: Record<CouponProblem, string> = {
  NOT_FOUND: 'This coupon code is not valid',
  NOT_STARTED: 'This coupon cannot be used yet',
  EXPIRED: 'This coupon has expired',
  USED_UP: 'This coupon has been used up',
  NOT_FOR_PLAN: 'This coupon is not for this plan',
  ALREADY_USED: 'You have already used this coupon',
};

const money = (value: { toString(): string }) => fromPaisa(toPaisa(value));

// The customer's own billing (api/billing): the plans, their plan and its
// usage, a free trial, coupon previews, the in-app checkout and their
// payments. A checkout is a PENDING payment the customer pays by the
// gateway's instructions; an admin's Mark paid (or a gateway's webhook)
// confirms it (PaymentConfirmationService).
@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionsService,
    private readonly gateways: PaymentGateways,
    private readonly settingsService: SettingsService,
  ) {}

  async plans(userId: string) {
    const [plans, sub] = await Promise.all([
      this.prisma.subscriptionPlan.findMany({ where: { isActive: true }, orderBy: { displayOrder: 'asc' } }),
      this.subscriptions.ensure(userId),
    ]);
    return {
      plans: plans.map((plan) => ({
        id: plan.id,
        name: plan.name,
        slug: plan.slug,
        billingCycle: plan.billingCycle,
        price: money(plan.price),
        currency: plan.currency,
        trialDays: plan.trialDays,
        featureLimits: plan.featureLimits,
        displayOrder: plan.displayOrder,
      })),
      currentPlanId: sub.planId,
      trialAvailable: this.trialAvailable(sub),
    };
  }

  async overview(userId: string) {
    const now = new Date();
    await this.subscriptions.sweepUser(userId, now);
    const sub = await this.subscriptions.ensure(userId);
    const [usage, pending, referralPct, { billingGraceDays }] = await Promise.all([
      this.usage(userId, sub),
      this.prisma.payment.findFirst({
        where: { userId, status: PaymentStatus.PENDING, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        orderBy: { createdAt: 'desc' },
        include: { plan: { select: { name: true } } },
      }),
      this.referralDiscountPercent(userId),
      this.settingsService.getCached(),
    ]);
    const planIsPaid = sub.plan.billingCycle !== BillingCycle.FREE;
    return {
      subscription: {
        planId: sub.planId,
        planName: sub.plan.name,
        planSlug: sub.plan.slug,
        billingCycle: sub.plan.billingCycle,
        price: money(sub.plan.price),
        lockedPrice: sub.lockedPrice ? money(sub.lockedPrice) : null,
        status: sub.status,
        isPaid: isPaidStatus(sub.status, planIsPaid),
        trialEndsAt: sub.trialEndsAt,
        currentPeriodStart: sub.currentPeriodStart,
        currentPeriodEnd: sub.currentPeriodEnd,
        graceEndsAt: sub.status === 'PAST_DUE' && sub.currentPeriodEnd ? graceEndsAt(sub.currentPeriodEnd, billingGraceDays) : null,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      },
      usage,
      pendingPayment: pending && {
        id: pending.id,
        displayId: displayPaymentId(pending.id),
        planId: pending.planId,
        planName: pending.plan.name,
        amount: money(pending.amount),
        gateway: pending.gateway,
        instructions: await this.gateways.manual.instructionsFor(pending),
        expiresAt: pending.expiresAt,
        createdAt: pending.createdAt,
      },
      referralDiscount: referralPct === null ? null : { percent: referralPct },
      trialAvailable: this.trialAvailable(sub),
    };
  }

  async startTrial(userId: string, planId: string) {
    const plan = await this.requirePaidPlan(planId);
    if (plan.trialDays <= 0) throw new BadRequestException('This plan has no free trial');
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`billing:${userId}`}))`;
      const sub = await this.subscriptions.ensure(userId, tx);
      if (sub.trialUsedAt) throw new BadRequestException('You have already used your free trial');
      if (sub.status === 'TRIALING' || isPaidStatus(sub.status, sub.plan.billingCycle !== BillingCycle.FREE)) {
        throw new BadRequestException('A free trial is for accounts on the Free plan');
      }
      const now = new Date();
      await this.subscriptions.applyPlan(tx, userId, plan.id, {
        changedBy: CHANGED_BY_CUSTOMER,
        reason: 'trial',
        fields: {
          status: 'TRIALING',
          trialEndsAt: new Date(now.getTime() + plan.trialDays * DAY_MS),
          trialUsedAt: now,
          currentPeriodStart: now,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          lockedPrice: null,
        },
      });
    });
    return this.overview(userId);
  }

  async couponPreview(userId: string, dto: CouponPreviewDto) {
    const plan = await this.requirePaidPlan(dto.planId);
    const { price, problem, couponPaisa, referralPaisa } = await this.priceFor(userId, plan, dto.code);
    return {
      valid: problem === null,
      ...(problem && { reason: problem, message: COUPON_MESSAGES[problem] }),
      listPrice: fromPaisa(price.listPaisa),
      discount: fromPaisa(price.discountPaisa),
      finalAmount: fromPaisa(price.finalPaisa),
      discountSource: price.source,
      couponDiscount: fromPaisa(couponPaisa),
      referralDiscount: fromPaisa(referralPaisa),
    };
  }

  // Opens the customer's one checkout: an older open one gives way to it.
  async checkout(userId: string, dto: CheckoutDto) {
    const plan = await this.requirePaidPlan(dto.planId);
    const code = dto.couponCode?.trim() || undefined;
    const { price, problem, coupon } = await this.priceFor(userId, plan, code);
    if (code && problem) throw new BadRequestException({ statusCode: 400, error: 'Bad Request', message: COUPON_MESSAGES[problem], reason: problem });

    const { billingCheckoutHours } = await this.settingsService.getCached();
    const payment = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`billing:${userId}`}))`;
      const sub = await this.subscriptions.ensure(userId, tx);
      await tx.payment.updateMany({ where: { userId, status: PaymentStatus.PENDING }, data: { status: PaymentStatus.FAILED, failureReason: 'replaced' } });
      return tx.payment.create({
        data: {
          userId,
          planId: plan.id,
          purpose: purposeFor(
            { planId: sub.planId, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd, planIsPaid: sub.plan.billingCycle !== BillingCycle.FREE },
            plan.id,
          ),
          listPrice: fromPaisa(price.listPaisa),
          amount: fromPaisa(price.finalPaisa),
          discountApplied: price.discountPaisa > 0 ? fromPaisa(price.discountPaisa) : null,
          couponId: price.source === 'COUPON' && coupon ? coupon.id : null,
          referralDiscount: price.source === 'REFERRAL' ? fromPaisa(price.discountPaisa) : null,
          currency: plan.currency,
          gateway: dto.gateway,
          status: PaymentStatus.PENDING,
          expiresAt: new Date(Date.now() + billingCheckoutHours * HOUR_MS),
        },
      });
    });

    return {
      paymentId: payment.id,
      displayId: displayPaymentId(payment.id),
      planId: plan.id,
      planName: plan.name,
      purpose: payment.purpose,
      listPrice: fromPaisa(price.listPaisa),
      amount: fromPaisa(price.finalPaisa),
      discount: fromPaisa(price.discountPaisa),
      discountSource: price.source,
      currency: payment.currency,
      gateway: payment.gateway,
      expiresAt: payment.expiresAt,
      next: await this.gateways.providerFor(payment.gateway).startCheckout(payment),
    };
  }

  async cancelCheckout(userId: string, paymentId: string) {
    const { count } = await this.prisma.payment.updateMany({
      where: { id: paymentId, userId, status: PaymentStatus.PENDING },
      data: { status: PaymentStatus.FAILED, failureReason: 'cancelled_by_user' },
    });
    if (count === 0) throw new NotFoundException('No open checkout with this id');
    return { success: true };
  }

  async payments(userId: string, page = 1, limit = 10) {
    const where = { userId };
    const [rows, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          plan: { select: { name: true } },
          invoice: { select: { id: true, invoiceNumber: true } },
          refund: { select: { amount: true, status: true, createdAt: true } },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);
    return {
      data: rows.map((row) => ({
        id: row.id,
        displayId: displayPaymentId(row.id),
        planId: row.planId,
        planName: row.plan.name,
        purpose: row.purpose,
        listPrice: row.listPrice ? money(row.listPrice) : null,
        amount: money(row.amount),
        discount: row.discountApplied ? money(row.discountApplied) : null,
        currency: row.currency,
        gateway: row.gateway,
        status: row.status,
        failureReason: row.failureReason,
        createdAt: row.createdAt,
        paidAt: row.paidAt,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        expiresAt: row.expiresAt,
        invoice: row.invoice,
        refund: row.refund && { amount: money(row.refund.amount), status: row.refund.status, createdAt: row.refund.createdAt },
      })),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  // Stop at the end of the paid period (or keep going, with resume).
  async setCancelAtPeriodEnd(userId: string, cancel: boolean) {
    const sub = await this.subscriptions.ensure(userId);
    if (!isPaidStatus(sub.status, sub.plan.billingCycle !== BillingCycle.FREE) || !sub.currentPeriodEnd) {
      throw new BadRequestException('Only a paid plan with an end date can be cancelled or resumed');
    }
    await this.prisma.userSubscription.update({ where: { userId }, data: { cancelAtPeriodEnd: cancel } });
    return this.overview(userId);
  }

  // Shown on the plans page: the account never had a trial and isn't on a
  // paid plan or a trial now.
  private trialAvailable(sub: SubscriptionWithPlan): boolean {
    return !sub.trialUsedAt && sub.status !== 'TRIALING' && !isPaidStatus(sub.status, sub.plan.billingCycle !== BillingCycle.FREE);
  }

  // Usage against the plan's limits -- reported only; nothing is enforced
  // yet. Transactions: posted this Dhaka month in the customer's own
  // workspaces (not group ones, which have no ledger).
  private async usage(userId: string, sub: SubscriptionWithPlan) {
    const { year, month } = dhakaToday();
    const workspaces = await this.prisma.business.findMany({ where: { ownerId: userId, deletedAt: null, type: { not: 'GROUP' } }, select: { id: true } });
    const transactionsThisMonth = workspaces.length
      ? await this.prisma.transaction.count({
          where: { businessId: { in: workspaces.map((w) => w.id) }, status: 'POSTED', reversalOfId: null, createdAt: { gte: dhakaMonthStart(year, month) } },
        })
      : 0;
    const limits = planLimits(sub.plan.featureLimits);
    return {
      transactionsThisMonth,
      transactionLimit: limits.transactionLimit,
      transactionsLeft: leftOf(transactionsThisMonth, limits.transactionLimit),
      resetsOn: dhakaDateKey(dhakaMonthStart(year, month + 1)),
      workspaces: workspaces.length,
      workspaceLimit: limits.workspaceLimit,
      pdfExport: limits.pdfExport,
    };
  }

  // The invited friend's discount on their first payment: they joined with
  // someone's code (a sign-up that didn't count -- self-referral, over the
  // referrer's monthly limit -- gets none), the program is on, and they
  // have never paid before.
  private async referralDiscountPercent(userId: string): Promise<number | null> {
    const [referral, paidBefore, settings] = await Promise.all([
      this.prisma.referral.findUnique({ where: { referredUserId: userId }, select: { id: true, status: true } }),
      this.prisma.payment.count({ where: { userId, status: { in: [PaymentStatus.SUCCESS, PaymentStatus.REFUNDED] } } }),
      this.settingsService.getReferralPrice(),
    ]);
    if (!referral || referral.status === 'CANCELLED' || paidBefore > 0 || !settings.programLive || settings.friendDiscountPct <= 0) return null;
    return settings.friendDiscountPct;
  }

  private async priceFor(
    userId: string,
    plan: SubscriptionPlan,
    code: string | undefined,
  ): Promise<{ price: Price; problem: CouponProblem | null; coupon: Coupon | null; couponPaisa: number; referralPaisa: number }> {
    const listPaisa = toPaisa(plan.price);
    const referralPct = await this.referralDiscountPercent(userId);
    const referralPaisa = referralPct === null ? 0 : referralDiscountPaisa(listPaisa, referralPct);

    let coupon: Coupon | null = null;
    let problem: CouponProblem | null = null;
    let couponPaisa = 0;
    if (code) {
      coupon = await this.prisma.coupon.findUnique({ where: { code: code.toUpperCase() } });
      const used = coupon?.oncePerPerson ? (await this.prisma.couponRedemption.count({ where: { couponId: coupon.id, userId } })) > 0 : false;
      problem = couponProblem(coupon, plan.id, new Date(), used);
      if (!problem && coupon) couponPaisa = couponDiscountPaisa(coupon, listPaisa);
    }
    return { price: priceWith(listPaisa, couponPaisa, referralPaisa), problem, coupon, couponPaisa, referralPaisa };
  }

  private async requirePaidPlan(planId: string): Promise<SubscriptionPlan> {
    const plan = await this.prisma.subscriptionPlan.findUnique({ where: { id: planId } });
    if (!plan || !plan.isActive) throw new NotFoundException('Plan not found');
    if (plan.billingCycle === BillingCycle.FREE) throw new BadRequestException('The Free plan needs no payment');
    return plan;
  }
}
