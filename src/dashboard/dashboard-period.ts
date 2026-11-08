// The admin Dashboard's period (the canvas's one "Choose period" picker): a
// month, a year or the admin's own days, as Dhaka calendar days. Pure, so the
// rules are tested apart from the queries.

const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

// Up to this many days the charts draw a bar a day; longer, a bar a month.
export const DAILY_UP_TO_DAYS = 62;
// The revenue chart shows six months at least and twelve at most.
const REVENUE_MIN_MONTHS = 6;
const REVENUE_MAX_MONTHS = 12;

export type PeriodKind = 'month' | 'year' | 'custom';
export type PeriodUnit = 'day' | 'month';

export interface DashboardRange {
  // 'YYYY-MM-DD', both ends counted; `to` is never after today.
  from: string;
  to: string;
  // What the picker chose: a whole month, a whole year, or other days.
  kind: PeriodKind;
  // A bar a day or a bar a month.
  unit: PeriodUnit;
  // The period runs up to today, so its figures are as of now.
  isNow: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');

// The day `n` days after a 'YYYY-MM-DD' day.
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

// The month `n` months after a 'YYYY-MM' month.
export function addMonths(month: string, n: number): string {
  const date = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n, 1));
  return date.toISOString().slice(0, 7);
}

// The last day of a 'YYYY-MM' month, 'YYYY-MM-DD'.
export function lastDayOf(month: string): string {
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  return `${month}-${pad(last)}`;
}

// The instant a Dhaka calendar day begins (18:00 UTC the day before).
export function dhakaStartOf(day: string): Date {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) - DHAKA_OFFSET_MS);
}

// How many days a range spans, both ends counted.
export function daysIn(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS) + 1;
}

// Every 'YYYY-MM' month a range touches, oldest first.
export function monthsIn(from: string, to: string): string[] {
  const months: string[] = [];
  for (let month = from.slice(0, 7); month <= to.slice(0, 7); month = addMonths(month, 1)) months.push(month);
  return months;
}

// Every day of a range, oldest first.
export function daysOf(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

// The period the picker sent, read for the page: what kind it is (from the
// days as sent, so October stays "a month" while it is still running), cut
// off at today, and whether its charts count days or months. A period that
// begins after today shrinks to today alone.
export function resolveDashboardRange(from: string, to: string, today: string): DashboardRange {
  const kind: PeriodKind =
    from.slice(8) === '01' && to === lastDayOf(from.slice(0, 7))
      ? 'month'
      : from.slice(5) === '01-01' && to.slice(5) === '12-31' && from.slice(0, 4) === to.slice(0, 4)
        ? 'year'
        : 'custom';
  const end = to > today ? today : to;
  const start = from > end ? end : from;
  const unit: PeriodUnit = kind !== 'year' && daysIn(start, end) <= DAILY_UP_TO_DAYS ? 'day' : 'month';
  return { from: start, to: end, kind, unit, isNow: end === today };
}

// The months the revenue chart shows, and the ones the period covers (drawn
// dark): the six months to a chosen month; for a year or other days, the
// months they touch -- the last twelve at most, widened to the six months up
// to the last one when there are fewer.
export function revenueMonths(range: DashboardRange): { months: string[]; highlight: string[] } {
  const touched = monthsIn(range.from, range.to);
  const last = touched[touched.length - 1];
  const sixToLast = Array.from({ length: REVENUE_MIN_MONTHS }, (_, i) => addMonths(last, i - REVENUE_MIN_MONTHS + 1));
  if (range.kind === 'month') return { months: sixToLast, highlight: [last] };
  const recent = touched.slice(-REVENUE_MAX_MONTHS);
  return { months: recent.length < REVENUE_MIN_MONTHS ? sixToLast : recent, highlight: touched };
}

// The span the period's revenue is compared with: the month before a
// month, the same days a year earlier for a year, and as many days just
// before for other days.
export function previousSpan(range: DashboardRange): { from: string; to: string } {
  if (range.kind === 'month') {
    const month = addMonths(range.from.slice(0, 7), -1);
    return { from: `${month}-01`, to: lastDayOf(month) };
  }
  if (range.kind === 'year') {
    const back = (day: string) => {
      const year = String(Number(day.slice(0, 4)) - 1);
      // 29 February has no day a year back: the 28th stands in.
      return day.slice(5) === '02-29' ? `${year}-02-28` : `${year}${day.slice(4)}`;
    };
    return { from: back(range.from), to: back(range.to) };
  }
  const days = daysIn(range.from, range.to);
  return { from: addDays(range.from, -days), to: addDays(range.from, -1) };
}

// How many instants fall in each bar: one per day of the range, or per
// month it touches, oldest first, with the empty ones.
export function countsPer(instants: Date[], range: Pick<DashboardRange, 'from' | 'to' | 'unit'>): { key: string; count: number }[] {
  const keyOf = (at: Date) => {
    const day = new Date(at.getTime() + DHAKA_OFFSET_MS).toISOString().slice(0, 10);
    return range.unit === 'day' ? day : day.slice(0, 7);
  };
  const counts = new Map<string, number>();
  for (const at of instants) {
    const key = keyOf(at);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const keys = range.unit === 'day' ? daysOf(range.from, range.to) : monthsIn(range.from, range.to);
  return keys.map((key) => ({ key, count: counts.get(key) ?? 0 }));
}
