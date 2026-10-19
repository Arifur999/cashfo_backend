import type { PrayerStatus } from '@prisma/client';
import { daysInMonth, NAMAZ_PRAYERS } from './habit-trackers.service.js';

// Days are `@db.Date` values (Dates at UTC midnight) or "YYYY-MM-DD" keys.
export const dayKey = (day: Date): string => day.toISOString().slice(0, 10);

export type PrayerCounts = Record<string, number>;

export const zeroCounts = (): PrayerCounts => Object.fromEntries(NAMAZ_PRAYERS.map((prayer) => [prayer, 0]));

interface NamazSheet {
  month: number | null;
  year: number | null;
  checks: { day: number; item: string; status: PrayerStatus }[];
}

// Prayers missed on the Namaz sheets from `since` through `today`, by prayer.
// A past day's prayer with no mark is missed, as is any marked "not prayed"
// (today's too); today's unmarked prayers aren't missed yet. Months with no
// sheet were never tracked, so they add nothing.
export function missedSince(sheets: NamazSheet[], since: Date, today: Date): PrayerCounts {
  const missed = zeroCounts();
  for (const sheet of sheets) {
    if (sheet.month === null || sheet.year === null) continue;
    const marks = new Map(sheet.checks.map((check) => [`${check.day}:${check.item}`, check.status]));
    for (let day = 1; day <= daysInMonth(sheet.month, sheet.year); day++) {
      const date = new Date(Date.UTC(sheet.year, sheet.month - 1, day));
      if (date < since || date > today) continue;
      for (const prayer of NAMAZ_PRAYERS) {
        const status = marks.get(`${day}:${prayer}`);
        if (status === 'MISSED' || (status === undefined && date < today)) missed[prayer]++;
      }
    }
  }
  return missed;
}
