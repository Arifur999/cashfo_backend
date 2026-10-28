import type { SubscriptionStatus } from '@prisma/client';
import { addDays } from './periods.js';

// "Your plan ends in 3 days".
export const ENDING_SOON_DAYS = 3;

export interface SubscriptionClock {
  status: SubscriptionStatus;
  planIsPaid: boolean;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

// What happens to a subscription at `now`:
// - a trial past its end without a payment: EXPIRED, back to free
// - a paid period past its end: CANCELLED at once if the customer asked to
//   stop, else PAST_DUE for the grace days, then EXPIRED, back to free
// A paid plan with no end (set by an admin) never moves.
export type Transition = { to: 'PAST_DUE' } | { to: 'EXPIRED' | 'CANCELLED'; dropToFree: true };

export function transitionAt(sub: SubscriptionClock, now: Date, graceDays: number): Transition | null {
  if (sub.status === 'TRIALING') {
    return sub.trialEndsAt && sub.trialEndsAt <= now ? { to: 'EXPIRED', dropToFree: true } : null;
  }
  if (!sub.planIsPaid || !sub.currentPeriodEnd || (sub.status !== 'ACTIVE' && sub.status !== 'PAST_DUE')) return null;
  if (sub.currentPeriodEnd > now) return null;
  if (sub.cancelAtPeriodEnd) return { to: 'CANCELLED', dropToFree: true };
  if (graceEndsAt(sub.currentPeriodEnd, graceDays) <= now) return { to: 'EXPIRED', dropToFree: true };
  return sub.status === 'ACTIVE' ? { to: 'PAST_DUE' } : null;
}

export const graceEndsAt = (periodEnd: Date, graceDays: number): Date => addDays(periodEnd, Math.max(0, graceDays));

// When a running trial or paid period ends within the next few days, that
// end; otherwise null.
export function endingSoon(sub: SubscriptionClock, now: Date, days = ENDING_SOON_DAYS): { endsAt: Date; trial: boolean } | null {
  const horizon = addDays(now, days);
  if (sub.status === 'TRIALING' && sub.trialEndsAt && sub.trialEndsAt > now && sub.trialEndsAt <= horizon) return { endsAt: sub.trialEndsAt, trial: true };
  if (sub.status === 'ACTIVE' && sub.planIsPaid && sub.currentPeriodEnd && sub.currentPeriodEnd > now && sub.currentPeriodEnd <= horizon) {
    return { endsAt: sub.currentPeriodEnd, trial: false };
  }
  return null;
}
