import type { BillingCycle, PaymentPurpose, SubscriptionStatus } from '@prisma/client';

const DAY_MS = 24 * 60 * 60 * 1000;

// `months` calendar months after `from`, at the same time of day; a day
// the target month doesn't have becomes its last day (31 Jan + 1 month =
// 28 or 29 Feb, never 3 March).
export function addMonths(from: Date, months: number): Date {
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(year, month, Math.min(from.getUTCDate(), lastDay), from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds(), from.getUTCMilliseconds()),
  );
}

// One paid period of the plan's cycle: a month or a year. A free plan has
// no period.
export function addCycle(from: Date, cycle: BillingCycle): Date | null {
  if (cycle === 'MONTHLY') return addMonths(from, 1);
  if (cycle === 'YEARLY') return addMonths(from, 12);
  return null;
}

export const addDays = (from: Date, days: number): Date => new Date(from.getTime() + days * DAY_MS);

export interface SubscriptionSnapshot {
  planId: string;
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  planIsPaid: boolean;
}

// On a paid plan right now: active, or past its end but inside the grace
// days. A trial is not a paid period.
export const isPaidStatus = (status: SubscriptionStatus, planIsPaid: boolean): boolean => planIsPaid && (status === 'ACTIVE' || status === 'PAST_DUE');

// What a checkout for `planId` is: the same paid plan again (a renewal),
// another plan while on a paid one (a change), or a first purchase.
export function purposeFor(sub: SubscriptionSnapshot | null, planId: string): PaymentPurpose {
  if (!sub || !isPaidStatus(sub.status, sub.planIsPaid)) return 'NEW';
  return sub.planId === planId ? 'RENEWAL' : 'UPGRADE';
}

// The period a payment confirmed at `paidAt` buys. Paying the plan you are
// on while its period still runs adds to the end of it; anything else
// starts at the payment.
export function paidPeriod(sub: SubscriptionSnapshot | null, planId: string, cycle: BillingCycle, paidAt: Date): { start: Date; end: Date | null } {
  const extends_ =
    sub !== null && sub.planId === planId && isPaidStatus(sub.status, sub.planIsPaid) && sub.currentPeriodEnd !== null && sub.currentPeriodEnd > paidAt;
  const start = extends_ ? (sub.currentPeriodEnd as Date) : paidAt;
  return { start, end: addCycle(start, cycle) };
}
