// The reading streak and this week's pages, worked out from the Asia/Dhaka
// days a person read on. Pure, so it is tested on its own.

import type { WeekStart } from '@prisma/client';
import { weekStartOf } from '../common/week-start.js';

export interface ReadingDay {
  date: string; // YYYY-MM-DD
  pages: number;
}

export interface ReadingSummary {
  // Days in a row with pages read, up to today -- or up to yesterday while
  // today has none yet, so the streak doesn't break before the day is over.
  streak: number;
  // The longest such run ever.
  best: number;
  // The seven days of this week, opening on the customer's week start
  // (Saturday unless they chose Sunday or Monday): the pages read each day,
  // 0 for a day with none or still to come.
  week: ReadingDay[];
}

const shift = (day: string, by: number): string => new Date(Date.parse(`${day}T00:00:00.000Z`) + by * 86_400_000).toISOString().slice(0, 10);

export function readingSummary(days: ReadingDay[], today: string, weekStart: WeekStart = 'SATURDAY'): ReadingSummary {
  const pages = new Map(days.filter((day) => day.pages > 0).map((day) => [day.date, day.pages]));

  let streak = 0;
  for (let day = pages.has(today) ? today : shift(today, -1); pages.has(day); day = shift(day, -1)) streak++;

  let best = 0;
  let run = 0;
  let previous: string | null = null;
  for (const date of [...pages.keys()].sort()) {
    run = previous !== null && shift(previous, 1) === date ? run + 1 : 1;
    best = Math.max(best, run);
    previous = date;
  }

  const opens = weekStartOf(today, weekStart);
  const week = Array.from({ length: 7 }, (_, i) => {
    const date = shift(opens, i);
    return { date, pages: pages.get(date) ?? 0 };
  });

  return { streak, best, week };
}
