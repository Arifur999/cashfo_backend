import type { ReferralStatus } from '@prisma/client';
import { commissionPaisa } from './referral-money.js';
import type { WhoCanEarn } from '../settings/referral-settings.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export type CancelReason = 'FRIEND_REFUNDED' | 'REFERRER_NOT_ON_PAID_PLAN' | 'PROGRAM_OFF' | 'SELF_REFERRAL' | 'MONTHLY_LIMIT' | 'ADMIN';

export interface FriendPaidInput {
  programLive: boolean;
  whoCanEarn: WhoCanEarn;
  // The referrer's own plan when the friend paid: a paid plan that is
  // ACTIVE or PAST_DUE. A free trial is not paid.
  referrerOnPaidPlan: boolean;
  paidPaisa: number;
  commissionPct: number;
  holdDays: number;
  paidAt: Date;
  now: Date;
}

export type FriendPaidOutcome =
  { status: 'PENDING' | 'AVAILABLE'; commissionPaisa: number; availableAt: Date } | { status: 'CANCELLED'; commissionPaisa: number; reason: CancelReason };

// What the friend's first payment does to a JOINED referral: a commission
// held for the refund window (already AVAILABLE when the window is over,
// e.g. a hold of 0 days), or nothing because the program was off or the
// referrer wasn't on a paid plan.
export function friendPaidOutcome(input: FriendPaidInput): FriendPaidOutcome {
  const commission = commissionPaisa(input.paidPaisa, input.commissionPct);
  if (!input.programLive) return { status: 'CANCELLED', commissionPaisa: commission, reason: 'PROGRAM_OFF' };
  if (input.whoCanEarn === 'PAID_PLAN' && !input.referrerOnPaidPlan) {
    return { status: 'CANCELLED', commissionPaisa: commission, reason: 'REFERRER_NOT_ON_PAID_PLAN' };
  }
  const availableAt = new Date(input.paidAt.getTime() + Math.max(0, input.holdDays) * DAY_MS);
  return { status: availableAt <= input.now ? 'AVAILABLE' : 'PENDING', commissionPaisa: commission, availableAt };
}

export interface FriendRefundedInput {
  status: ReferralStatus;
  availableAt: Date | null;
  cancelOnRefund: boolean;
  paidPaisa: number;
  refundPaisa: number;
  full: boolean;
  commissionRatePct: number;
  now: Date;
}

export type FriendRefundedOutcome = { action: 'CANCEL' } | { action: 'REDUCE'; commissionPaisa: number } | null;

// A refund of the friend's payment inside the refund window: a full one
// cancels the commission; a partial one leaves the commission on what was
// kept. Once the window is over (or with the setting off) nothing changes;
// the admin's payout checks show the refund instead.
export function friendRefundedOutcome(input: FriendRefundedInput): FriendRefundedOutcome {
  if (!input.cancelOnRefund || input.status !== 'PENDING') return null;
  if (input.availableAt && input.availableAt <= input.now) return null;
  const kept = Math.max(0, input.paidPaisa - input.refundPaisa);
  if (input.full || kept === 0) return { action: 'CANCEL' };
  const reduced = commissionPaisa(kept, input.commissionRatePct);
  return reduced > 0 ? { action: 'REDUCE', commissionPaisa: reduced } : { action: 'CANCEL' };
}

// Which tab of "Friends who joined with your link" a friend falls under.
export type FriendFilter = 'BOUGHT' | 'NOT_YET' | 'REFUNDED' | 'OTHER';

export function friendFilterOf(row: { status: ReferralStatus; paymentId: string | null; cancelReason: string | null }): FriendFilter {
  if (row.status === 'JOINED') return 'NOT_YET';
  if (row.status === 'CANCELLED' && row.cancelReason === 'FRIEND_REFUNDED') return 'REFUNDED';
  if (row.paymentId) return 'BOUGHT';
  return 'OTHER';
}
