// The calendar months a date range touches, each clipped to the range, so a
// report can sum one bucket per month. Dates are 'YYYY-MM-DD' days (the
// shape the frontend sends and a date-only transactionDate stores), read at
// UTC midnight like the rest of the reports service.

export interface MonthBucket {
  // 'YYYY-MM'
  key: string;
  // Inclusive start, exclusive end.
  start: Date;
  end: Date;
}

export const MAX_REPORT_MONTHS = 24;

const dayStart = (day: string) => new Date(`${day.slice(0, 10)}T00:00:00.000Z`);
const nextDay = (date: Date) => new Date(date.getTime() + 24 * 60 * 60 * 1000);

// Both ends inclusive; an empty list when the range is backwards or spans
// more than MAX_REPORT_MONTHS months.
export function monthBucketsBetween(dateFrom: string, dateTo: string): MonthBucket[] {
  const from = dayStart(dateFrom);
  const to = nextDay(dayStart(dateTo));
  if (!(from < to)) return [];

  const buckets: MonthBucket[] = [];
  let cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  while (cursor < to) {
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    buckets.push({
      key: cursor.toISOString().slice(0, 7),
      start: cursor > from ? cursor : from,
      end: monthEnd < to ? monthEnd : to,
    });
    if (buckets.length > MAX_REPORT_MONTHS) return [];
    cursor = monthEnd;
  }
  return buckets;
}

export interface ActiveMonth {
  year: number;
  // 1-12
  month: number;
  // Transactions dated in the month.
  count: number;
}

// Days with their transaction counts folded into calendar months, newest
// first. A day is a date-only value read at UTC midnight, so its month needs
// no time zone.
export function foldIntoMonths(days: { date: Date; count: number }[]): ActiveMonth[] {
  const months = new Map<number, ActiveMonth>();
  for (const { date, count } of days) {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const key = year * 12 + month;
    const row = months.get(key);
    if (row) row.count += count;
    else months.set(key, { year, month, count });
  }
  return [...months.entries()].sort((a, b) => b[0] - a[0]).map(([, row]) => row);
}
