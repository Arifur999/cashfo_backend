// "Today" and "this year" for the personal Habit Tracker features are the
// Asia/Dhaka calendar (a fixed UTC+6 -- Bangladesh has no DST), not UTC's: a
// book finished at 1am on 1 January would otherwise count for last year.
// (HabitsService's older /api/habits endpoints still use UTC.)
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

// Today's Asia/Dhaka calendar date. For the month sheets this matters most
// around Fajr: 00:00-06:00 local would otherwise still be the PREVIOUS UTC
// day, mis-highlighting today and delaying when yesterday's unticked prayers
// count as missed.
export function dhakaToday(): { year: number; month: number; day: number } {
  const d = new Date(Date.now() + DHAKA_OFFSET_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function dhakaYear(date: Date): number {
  return new Date(date.getTime() + DHAKA_OFFSET_MS).getUTCFullYear();
}

// 'YYYY-MM-DD' of the Dhaka calendar date.
export function dhakaDateKey(date: Date): string {
  return new Date(date.getTime() + DHAKA_OFFSET_MS).toISOString().slice(0, 10);
}

// The first day of the Dhaka calendar month `offset` months from now, and
// of the month after it, as Dates at UTC midnight -- the bounds of "this
// month" (offset 0) for a `@db.Date` column or a date stored as
// `new Date('YYYY-MM-DD')`.
export function dhakaMonthRange(offset = 0): { start: Date; end: Date } {
  const { year, month } = dhakaToday();
  return { start: new Date(Date.UTC(year, month - 1 + offset, 1)), end: new Date(Date.UTC(year, month + offset, 1)) };
}

// The instant a Dhaka calendar month begins -- for timestamp columns, so
// "this month" starts at Dhaka midnight (18:00 UTC the evening before), not
// at the server's own midnight. `month` may run past 1-12.
export function dhakaMonthStart(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, 1) - DHAKA_OFFSET_MS);
}

// The Dhaka calendar date as a Date at UTC midnight -- the shape a
// `@db.Date` column stores and returns.
export function dhakaDateOnly(date: Date): Date {
  return new Date(`${dhakaDateKey(date)}T00:00:00.000Z`);
}
