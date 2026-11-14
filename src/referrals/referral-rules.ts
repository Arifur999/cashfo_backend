import type { CommissionStatus } from '@prisma/client';
import { commissionPaisa } from './referral-money.js';
import type { WhoCanEarn } from '../settings/referral-settings.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// Why a commission earned nothing (CANCELLED), or was taken back.
export type CancelReason = 'FRIEND_REFUNDED' | 'REFERRER_NOT_ON_PAID_PLAN' | 'PROGRAM_OFF' | 'ADMIN';

// A sign-up that never counts: the referrer's own phone or email, or past
// their monthly limit (UserProvisioningService.recordReferral). It earns
// nothing and gives the friend no discount.
export const BLOCKED_SIGNUP_REASONS = ['SELF_REFERRAL', 'MONTHLY_LIMIT'] as const;

export const isBlockedSignup = (referral: { status: string; cancelReason: string | null }): boolean =>
  referral.status === 'CANCELLED' && (BLOCKED_SIGNUP_REASONS as readonly string[]).includes(referral.cancelReason ?? '');

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
  | { status: 'ON_HOLD' | 'AVAILABLE'; commissionPaisa: number; availableAt: Date }
  | { status: 'CANCELLED'; commissionPaisa: number; availableAt: Date; reason: CancelReason };

// What one payment of an invited friend's earns the referrer: a share held
// for the refund window (already AVAILABLE when the window is over, e.g. a
// hold of 0 days), or nothing because the program was off or the referrer
// wasn't on a paid plan.
export function friendPaidOutcome(input: FriendPaidInput): FriendPaidOutcome {
  const commission = commissionPaisa(input.paidPaisa, input.commissionPct);
  const availableAt = new Date(input.paidAt.getTime() + Math.max(0, input.holdDays) * DAY_MS);
  if (!input.programLive) return { status: 'CANCELLED', commissionPaisa: commission, availableAt, reason: 'PROGRAM_OFF' };
  if (input.whoCanEarn === 'PAID_PLAN' && !input.referrerOnPaidPlan) {
    return { status: 'CANCELLED', commissionPaisa: commission, availableAt, reason: 'REFERRER_NOT_ON_PAID_PLAN' };
  }
  return { status: availableAt <= input.now ? 'AVAILABLE' : 'ON_HOLD', commissionPaisa: commission, availableAt };
}

export interface FriendRefundedInput {
  status: CommissionStatus;
  availableAt: Date;
  cancelOnRefund: boolean;
  paidPaisa: number;
  refundPaisa: number;
  full: boolean;
  commissionRatePct: number;
  now: Date;
}

export type FriendRefundedOutcome = { action: 'REVERSE' } | { action: 'REDUCE'; commissionPaisa: number } | null;

// A refund of the payment inside its refund window: a full one reverses
// the commission; a partial one leaves the commission on what was kept.
// Once the window is over (or with the setting off) nothing changes; the
// payout desk shows the refund on that line instead.
export function friendRefundedOutcome(input: FriendRefundedInput): FriendRefundedOutcome {
  if (!input.cancelOnRefund || input.status !== 'ON_HOLD') return null;
  if (input.availableAt <= input.now) return null;
  const kept = Math.max(0, input.paidPaisa - input.refundPaisa);
  if (input.full || kept === 0) return { action: 'REVERSE' };
  const reduced = commissionPaisa(kept, input.commissionRatePct);
  return reduced > 0 ? { action: 'REDUCE', commissionPaisa: reduced } : { action: 'REVERSE' };
}

// How an invited friend stands (Referrals > Referred users):
//   PAYING    on a paid plan now
//   STOPPED   paid before, not now
//   REFUNDED  paid, and every payment was refunded
//   FREE      never paid
//   BLOCKED   a sign-up that doesn't count (self-referral, monthly limit)
export type FriendStanding = 'PAYING' | 'STOPPED' | 'REFUNDED' | 'FREE' | 'BLOCKED';

export function friendStanding(input: { blocked: boolean; onPaidPlan: boolean; paidCount: number; refundedCount: number }): FriendStanding {
  if (input.blocked) return 'BLOCKED';
  if (input.onPaidPlan) return 'PAYING';
  if (input.paidCount === 0) return input.refundedCount > 0 ? 'REFUNDED' : 'FREE';
  return 'STOPPED';
}

// What renewals falling in [from, until) should earn the referrer: each
// paying friend's price (their locked one if they have it) at the rate.
export function expectedRenewalEarnings(friends: { periodEnd: Date | null; pricePaisa: number }[], from: Date, until: Date, ratePct: number): { paisa: number; count: number } {
  const due = friends.filter((f) => f.periodEnd !== null && f.periodEnd >= from && f.periodEnd < until);
  return { paisa: due.reduce((total, f) => total + commissionPaisa(f.pricePaisa, ratePct), 0), count: due.length };
}
