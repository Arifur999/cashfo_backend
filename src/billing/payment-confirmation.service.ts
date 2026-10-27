import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { BillingHooks } from './billing-hooks.js';
import { BillingNotices } from './billing-notices.js';
import { nextInvoiceNumber } from './invoice-number.js';
import { CHANGED_BY_SYSTEM, SubscriptionsService } from './subscriptions.service.js';

export interface MarkPaidInput {
  // The gateway's transaction id (the bKash/Nagad TrxID).
  reference: string;
  paidAt?: Date;
  // The number the money came from.
  payerAccount?: string | null;
  note?: string | null;
}

// Who confirmed it: an admin (audited), or null for a gateway's webhook.
export interface Actor {
  adminId: string;
  ipAddress?: string;
}

const HOUR_MS = 60 * 60 * 1000;

// Confirming, failing and re-opening a customer's payment. Mark paid does
// everything a paid payment means in one database transaction: the
// payment, its invoice, the coupon's use, the plan and its period, and
// whatever else listens (BillingHooks); the bell and the receipt follow.
@Injectable()
export class PaymentConfirmationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionsService,
    private readonly hooks: BillingHooks,
    private readonly notices: BillingNotices,
    private readonly settingsService: SettingsService,
  ) {}

  async markPaid(id: string, input: MarkPaidInput, actor: Actor | null) {
    const paidAt = input.paidAt ?? new Date();
    if (paidAt.getTime() > Date.now() + 5 * 60 * 1000) throw new BadRequestException('The payment date cannot be in the future');

    const result = await this.prisma.$transaction(async (tx) => {
      // Claimed with a condition, like a refund: of two Mark paid presses
      // only one moves the payment off PENDING.
      const claimed = await tx.payment.updateMany({
        where: { id, status: PaymentStatus.PENDING },
        data: {
          status: PaymentStatus.SUCCESS,
          paidAt,
          gatewayReferenceId: input.reference,
          payerAccount: input.payerAccount ?? null,
          markedPaidBy: actor?.adminId ?? null,
          failureReason: null,
        },
      });
      if (claimed.count === 0) await this.refuse(tx, id, 'marked paid');

      const payment = await tx.payment.findUniqueOrThrow({ where: { id }, include: { plan: true, invoice: true } });

      let subscription: Awaited<ReturnType<SubscriptionsService['activateFromPayment']>>['subscription'] | null = null;
      let periodEnd: Date | null = null;
      if (payment.userId) {
        const activated = await this.subscriptions.activateFromPayment(
          tx,
          { ...payment, userId: payment.userId },
          payment.plan,
          paidAt,
          actor?.adminId ?? CHANGED_BY_SYSTEM,
        );
        subscription = activated.subscription;
        periodEnd = activated.periodEnd;
        await tx.payment.update({ where: { id }, data: { periodStart: activated.periodStart, periodEnd: activated.periodEnd } });
      }

      const coupon = payment.couponId ? await tx.coupon.findUnique({ where: { id: payment.couponId }, select: { id: true, code: true } }) : null;
      if (coupon) {
        await tx.couponRedemption.create({
          data: {
            couponId: coupon.id,
            userId: payment.userId,
            platformUserId: payment.userId ? null : payment.platformUserId,
            planId: payment.planId,
            paymentId: id,
          },
        });
        await tx.coupon.update({ where: { id: coupon.id }, data: { timesRedeemed: { increment: 1 } } });
      }

      const invoice = payment.invoice ?? (await this.createInvoice(tx, payment, coupon?.code ?? null));
      const updated = await tx.payment.findUniqueOrThrow({ where: { id } });
      await this.hooks.runPaid(updated, tx);

      if (actor) {
        await tx.auditLog.create({
          data: {
            adminUserId: actor.adminId,
            action: 'PAYMENT_MARKED_PAID',
            entityType: 'Payment',
            entityId: id,
            oldValue: { status: PaymentStatus.PENDING },
            newValue: {
              status: PaymentStatus.SUCCESS,
              gatewayReferenceId: input.reference,
              paidAt: paidAt.toISOString(),
              payerAccount: input.payerAccount ?? null,
              note: input.note ?? null,
              invoiceNumber: invoice.invoiceNumber,
              periodEnd: periodEnd?.toISOString() ?? null,
            },
            ipAddress: actor.ipAddress,
          },
        });
      }

      return {
        payment: updated,
        invoice,
        subscription: subscription && {
          planId: subscription.planId,
          planName: subscription.plan.name,
          status: subscription.status,
          currentPeriodStart: subscription.currentPeriodStart,
          currentPeriodEnd: subscription.currentPeriodEnd,
        },
        planName: payment.plan.name,
      };
    });

    await this.notices.paid(result.payment, result.planName, result.invoice.invoiceNumber);
    const { planName: _planName, ...answer } = result;
    return answer;
  }

  async markFailed(id: string, reason: string, actor: Actor | null) {
    const payment = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.payment.updateMany({
        where: { id, status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.FAILED, failureReason: reason },
      });
      if (claimed.count === 0) await this.refuse(tx, id, 'marked failed');
      if (actor) {
        await tx.auditLog.create({
          data: {
            adminUserId: actor.adminId,
            action: 'PAYMENT_MARKED_FAILED',
            entityType: 'Payment',
            entityId: id,
            oldValue: { status: PaymentStatus.PENDING },
            newValue: { status: PaymentStatus.FAILED, reason },
            ipAddress: actor.ipAddress,
          },
        });
      }
      return tx.payment.findUniqueOrThrow({ where: { id }, include: { plan: { select: { name: true } } } });
    });
    if (payment.userId) {
      await this.notices.bell(payment.userId, {
        key: `payment:${id}:failed`,
        data: { event: 'PAYMENT_FAILED', paymentId: id, planName: payment.plan.name, amount: Number(payment.amount).toFixed(2), reason },
      });
    }
    const { plan: _plan, ...row } = payment;
    return { payment: row };
  }

  // Retry: a failed payment's checkout opens again for the checkout hours.
  // The customer's other open checkout, if any, gives way to it.
  async reopen(id: string, actor: Actor) {
    const { billingCheckoutHours } = await this.settingsService.getCached();
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id }, select: { status: true, userId: true } });
      if (!payment) throw new NotFoundException('Payment not found');
      if (payment.userId) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`billing:${payment.userId}`}))`;
      const claimed = await tx.payment.updateMany({
        where: { id, status: PaymentStatus.FAILED },
        data: { status: PaymentStatus.PENDING, failureReason: null, expiresAt: new Date(Date.now() + billingCheckoutHours * HOUR_MS) },
      });
      if (claimed.count === 0) throw new BadRequestException('Only failed payments can be retried');
      if (payment.userId) {
        await tx.payment.updateMany({
          where: { userId: payment.userId, status: PaymentStatus.PENDING, id: { not: id } },
          data: { status: PaymentStatus.FAILED, failureReason: 'replaced' },
        });
      }
      await tx.auditLog.create({
        data: {
          adminUserId: actor.adminId,
          action: 'PAYMENT_RETRY_TRIGGERED',
          entityType: 'Payment',
          entityId: id,
          oldValue: { status: payment.status },
          newValue: { status: PaymentStatus.PENDING },
          ipAddress: actor.ipAddress,
        },
      });
      return tx.payment.findUniqueOrThrow({ where: { id } });
    });
  }

  private async refuse(tx: Prisma.TransactionClient, id: string, what: string): Promise<never> {
    const current = await tx.payment.findUnique({ where: { id }, select: { status: true } });
    if (!current) throw new NotFoundException('Payment not found');
    throw new ConflictException(`Only a pending payment can be ${what}; this one is ${current.status.toLowerCase()}`);
  }

  private async createInvoice(tx: Prisma.TransactionClient, payment: Prisma.PaymentGetPayload<{ include: { plan: true } }>, couponCode: string | null) {
    let issuedTo = 'Unknown customer';
    if (payment.userId) {
      const user = await tx.user.findUnique({ where: { id: payment.userId }, select: { name: true, email: true } });
      if (user) issuedTo = `${user.name} <${user.email}>`;
    } else if (payment.platformUserId) {
      const legacy = await tx.platformUser.findUnique({ where: { id: payment.platformUserId }, select: { name: true, email: true } });
      if (legacy) issuedTo = `${legacy.name} <${legacy.email}>`;
    }
    const listPrice = Number(payment.listPrice ?? payment.amount);
    const discount = Math.round((listPrice - Number(payment.amount)) * 100) / 100;
    const lineItems: { description: string; amount: number }[] = [{ description: `${payment.plan.name} subscription`, amount: listPrice }];
    if (discount > 0) {
      lineItems.push({ description: couponCode ? `Coupon ${couponCode}` : payment.referralDiscount ? 'Referral discount' : 'Discount', amount: -discount });
    }
    return tx.invoice.create({
      data: { paymentId: payment.id, invoiceNumber: await nextInvoiceNumber(tx), issuedTo, lineItems, totalAmount: payment.amount },
    });
  }
}
