import type { WeekStart } from '@prisma/client';

// Settings > App > "Week starts on": the weekday (0 Sunday ... 6 Saturday)
// a customer's weeks open on. The app's default is Saturday.
export const WEEK_START_DAY: Record<WeekStart, number> = { SATURDAY: 6, SUNDAY: 0, MONDAY: 1 };

const DAY_MS = 86_400_000;

// The first day of the week holding `day` ('YYYY-MM-DD').
export function weekStartOf(day: string, weekStart: WeekStart = 'SATURDAY'): string {
  const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay();
  const back = (weekday - WEEK_START_DAY[weekStart] + 7) % 7;
  return new Date(Date.parse(`${day}T00:00:00.000Z`) - back * DAY_MS).toISOString().slice(0, 10);
}
