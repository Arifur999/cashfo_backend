// "Today" and "this year" for the personal Habit Tracker features are the
// Asia/Dhaka calendar (a fixed UTC+6 -- Bangladesh has no DST), not UTC's: a
// book finished at 1am on 1 January would otherwise count for last year.
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

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
