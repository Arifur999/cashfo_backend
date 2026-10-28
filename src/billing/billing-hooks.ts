import { Injectable } from '@nestjs/common';
import type { Payment, Prisma } from '@prisma/client';

export type PaymentPaidHook = (payment: Payment, tx: Prisma.TransactionClient) => Promise<void>;
export type PaymentRefundedHook = (payment: Payment, tx: Prisma.TransactionClient, refund: { amount: number; full: boolean }) => Promise<void>;

// Where other features hear about a customer's payment, inside the same
// database transaction that confirms or refunds it. Referral commissions
// (ReferralCommissions.onFriendPaid / onFriendRefunded) register here; a
// hook that throws rolls the whole confirmation back.
@Injectable()
export class BillingHooks {
  private readonly paid: PaymentPaidHook[] = [];
  private readonly refunded: PaymentRefundedHook[] = [];

  onPaid(hook: PaymentPaidHook) {
    this.paid.push(hook);
  }

  onRefunded(hook: PaymentRefundedHook) {
    this.refunded.push(hook);
  }

  async runPaid(payment: Payment, tx: Prisma.TransactionClient) {
    for (const hook of this.paid) await hook(payment, tx);
  }

  async runRefunded(payment: Payment, tx: Prisma.TransactionClient, refund: { amount: number; full: boolean }) {
    for (const hook of this.refunded) await hook(payment, tx, refund);
  }
}
