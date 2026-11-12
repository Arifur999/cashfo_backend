import { SavingsPlanHorizon } from '@prisma/client';

// How far ahead a plan is needed, in months, for the horizons that are a
// length of time; a date or "some day" has none.
export const HORIZON_MONTHS: Partial<Record<SavingsPlanHorizon, number>> = { THREE_MONTHS: 3, SIX_MONTHS: 6, ONE_YEAR: 12, TWO_YEARS: 24 };

// The kinds of thing a plan can be for (the form's chips).
export const SAVINGS_PLAN_CATEGORIES = ['trip', 'phone', 'umrah', 'education', 'wedding', 'others'] as const;

const day = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const pad = (n: number) => String(n).padStart(2, '0');

// `iso` (YYYY-MM-DD) plus n months, kept to the last day of a shorter month.
export function addMonths(iso: string, months: number): string {
  const y = +iso.slice(0, 4);
  const m = +iso.slice(5, 7) - 1 + months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const date = new Date(Date.UTC(y, m, Math.min(+iso.slice(8, 10), last)));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

// The day a plan is needed by, counted from today: a length of time runs
// from today (nothing is saved for it yet), a date is that date, and some
// day has none.
export function planNeedBy(plan: { horizon: SavingsPlanHorizon; needBy: string | null }, today: string): string | null {
  const months = HORIZON_MONTHS[plan.horizon];
  if (months) return addMonths(today, months);
  return plan.horizon === 'BY_DATE' ? plan.needBy : null;
}

// Months from today to the day it is needed by (at least one), or 0 when it
// has no date.
export function planMonths(plan: { horizon: SavingsPlanHorizon; needBy: string | null }, today: string): number {
  const months = HORIZON_MONTHS[plan.horizon];
  if (months) return months;
  if (plan.horizon !== 'BY_DATE' || !plan.needBy) return 0;
  return Math.max(1, Math.ceil((day(plan.needBy) - day(today)) / 86_400_000 / 30.44));
}

// What starting it today means a month, rounded up to the next 10 taka;
// 0 with no date.
export function planMonthly(plan: { amount: number; horizon: SavingsPlanHorizon; needBy: string | null }, today: string): number {
  const months = planMonths(plan, today);
  return months ? Math.ceil(plan.amount / months / 10) * 10 : 0;
}
