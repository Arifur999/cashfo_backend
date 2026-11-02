import { Injectable, Logger } from '@nestjs/common';
import type { Payment, Prisma } from '@prisma/client';

// Work a hook leaves for after the payment's transaction has committed
// (an email), so nothing goes out for a confirmation that rolled back.
export type AfterCommit = () => Promise<void>;

export type PaymentPaidHook = (payment: Payment, tx: Prisma.TransactionClient) => Promise<AfterCommit | void>;
export type PaymentRefundedHook = (payment: Payment, tx: Prisma.TransactionClient, refund: { amount: number; full: boolean }) => Promise<void>;

// Where other features hear about a customer's payment, inside the same
// database transaction that confirms or refunds it. Referral commissions
// (ReferralCommissions.onFriendPaid / onFriendRefunded) register here; a
// hook that throws rolls the whole confirmation back.
@Injectable()
export class BillingHooks {
  private readonly logger = new Logger(BillingHooks.name);
  private readonly paid: PaymentPaidHook[] = [];
  private readonly refunded: PaymentRefundedHook[] = [];

  onPaid(hook: PaymentPaidHook) {
    this.paid.push(hook);
  }

  onRefunded(hook: PaymentRefundedHook) {
    this.refunded.push(hook);
  }

  // Returns what the hooks left for after the commit (afterCommit()).
  async runPaid(payment: Payment, tx: Prisma.TransactionClient): Promise<AfterCommit[]> {
    const later: AfterCommit[] = [];
    for (const hook of this.paid) {
      const next = await hook(payment, tx);
      if (next) later.push(next);
    }
    return later;
  }

  async runRefunded(payment: Payment, tx: Prisma.TransactionClient, refund: { amount: number; full: boolean }) {
    for (const hook of this.refunded) await hook(payment, tx, refund);
  }

  // Best-effort: the payment is already confirmed.
  async afterCommit(work: AfterCommit[] | undefined) {
    for (const run of work ?? []) {
      try {
        await run();
      } catch (error) {
        this.logger.warn(`A payment follow-up failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}
