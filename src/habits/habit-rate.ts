import type { Habit, WeekStart } from '@prisma/client';
import { weekStartOf } from '../common/week-start.js';

// The "done in the last 30 days" share on Habit stats, worked out the way
// the app's own completionRate (habitDisplay.ts) does it: the completed
// days in the window, over the days the habit was planned for -- not over
// 30, which made a Sunday-to-Thursday habit done every planned day read
// 71%. Pure.

export type RateHabit = Pick<Habit, 'frequencyType' | 'weeklyDays' | 'weeklyCount' | 'createdAt'>;

const DAY_MS = 86_400_000;
const shift = (day: string, by: number): string => new Date(Date.parse(`${day}T00:00:00.000Z`) + by * DAY_MS).toISOString().slice(0, 10);
const weekday = (day: string): number => new Date(`${day}T00:00:00.000Z`).getUTCDay();

// The last `count` days ending on `today`, oldest first.
export const lastDays = (today: string, count: number): string[] => Array.from({ length: count }, (_, i) => shift(today, i - count + 1));

// How many of the days the habit is planned for: a certain-days habit only
// its weekdays, an N-times-a-week one N for each week the days touch.
export function plannedCount(habit: Pick<RateHabit, 'frequencyType' | 'weeklyDays' | 'weeklyCount'>, days: string[], weekStart: WeekStart = 'SATURDAY'): number {
  if (habit.frequencyType === 'WEEKLY_COUNT') {
    const weeks = new Set(days.map((day) => weekStartOf(day, weekStart)));
    return weeks.size * Math.max(1, habit.weeklyCount ?? 1);
  }
  if (habit.frequencyType === 'WEEKLY_DAYS') return days.filter((day) => habit.weeklyDays.includes(weekday(day))).length;
  return days.length;
}

// The first day a habit counts from: the day it was added, or its first
// log when that is earlier (a habit can be logged for days before it was
// added), as the app works it out.
export const habitStart = (habit: Pick<RateHabit, 'createdAt'>, firstLog: string | null): string => {
  const created = habit.createdAt.toISOString().slice(0, 10);
  return firstLog && firstLog < created ? firstLog : created;
};

// 0-100, or null while nothing in the window was planned yet.
export function completionRate(
  habit: RateHabit,
  done: ReadonlySet<string>,
  today: string,
  firstLog: string | null,
  weekStart: WeekStart = 'SATURDAY',
  windowDays = 30,
): { planned: number; done: number; rate: number | null } {
  const start = habitStart(habit, firstLog);
  const days = lastDays(today, windowDays).filter((day) => day >= start);
  const planned = plannedCount(habit, days, weekStart);
  const doneCount = days.filter((day) => done.has(day)).length;
  return { planned, done: doneCount, rate: planned === 0 ? null : Math.min(100, Math.round((doneCount / planned) * 100)) };
}
