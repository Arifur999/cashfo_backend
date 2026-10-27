import { dhakaDateKey } from '../common/dhaka.js';

// The admin dashboard's sums, apart from the queries so they can be tested
// on their own. Pure.

export const DASHBOARD_PERIODS = ['7d', '30d', '90d'] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

export const periodDays = (period: DashboardPeriod): number => ({ '7d': 7, '30d': 30, '90d': 90 })[period];

const DAY_MS = 86_400_000;

// Percent change from `before` to `now`, one decimal; null when there was
// nothing before to compare with.
export function pctChange(now: number, before: number): number | null {
  if (!before) return null;
  return Math.round(((now - before) / before) * 1000) / 10;
}

// `part` as a share of `whole`, one decimal; 0 for an empty whole.
export const shareOf = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

// One row per Dhaka day for the `days` days ending today (oldest first),
// counting the instants that fall on each.
export function perDhakaDay(instants: Date[], days: number, now: Date): { date: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const at of instants) {
    const key = dhakaDateKey(at);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from({ length: days }, (_, i) => {
    const date = dhakaDateKey(new Date(now.getTime() - (days - 1 - i) * DAY_MS));
    return { date, count: counts.get(date) ?? 0 };
  });
}

// "Tickets with no reply": an unsolved ticket whose newest message (notes
// for admins left out) is the customer's, or that has none yet -- the same
// rule as the tickets queue's "needs a reply". Since: that message, or the
// opening.
export interface TicketForReply {
  status: string;
  createdAt: Date;
  newest: { senderType: string; createdAt: Date } | null;
}

export function waitingForReply(ticket: TicketForReply): Date | null {
  if (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') return null;
  if (ticket.newest && ticket.newest.senderType !== 'USER') return null;
  return ticket.newest?.createdAt ?? ticket.createdAt;
}

export function ticketsNoReply(tickets: TicketForReply[]): { count: number; oldestWaitingSince: Date | null } {
  const since = tickets.map(waitingForReply).filter((at): at is Date => at !== null);
  return { count: since.length, oldestWaitingSince: since.length ? new Date(Math.min(...since.map((at) => at.getTime()))) : null };
}

// Accounts by plan: every live customer under the plan their subscription
// is on (no subscription counts as the free plan), the plans in their own
// order, each with its share of the whole.
export interface PlanRow {
  id: string;
  name: string;
  price: { toString(): string };
  billingCycle: string;
}

export function accountsByPlan(plans: PlanRow[], counts: Map<string | null, number>): { planId: string; name: string; price: string; billingCycle: string; count: number; pct: number }[] {
  const freeId = plans.find((plan) => plan.billingCycle === 'FREE')?.id ?? null;
  const merged = new Map<string, number>();
  for (const [planId, count] of counts) {
    const id = planId ?? freeId;
    if (id) merged.set(id, (merged.get(id) ?? 0) + count);
  }
  const total = [...merged.values()].reduce((sum, count) => sum + count, 0);
  return plans.map((plan) => {
    const count = merged.get(plan.id) ?? 0;
    return { planId: plan.id, name: plan.name, price: Number(plan.price.toString()).toFixed(2), billingCycle: plan.billingCycle, count, pct: shareOf(count, total) };
  });
}

// The last `count` whole months before this one, from a 'YYYY-MM' trend
// that ends with this month, and the change of the newest of them on the
// one before it ("September ৳ 72,155, +12.5%").
export function lastFullMonths(trend: { month: string; amount: number }[], thisMonth: string, count: number) {
  const full = trend.filter((row) => row.month < thisMonth).slice(-count);
  const [before, last] = full.slice(-2);
  return { months: full, changePct: last && before ? pctChange(last.amount, before.amount) : null };
}
