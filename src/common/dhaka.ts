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

// The Dhaka calendar date as a Date at UTC midnight -- the shape a
// `@db.Date` column stores and returns.
export function dhakaDateOnly(date: Date): Date {
  return new Date(`${dhakaDateKey(date)}T00:00:00.000Z`);
}
