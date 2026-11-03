import type { ReminderKind } from '@prisma/client';

// When the Habit Tracker's reminders fire. Pure: RemindersScheduler reads
// the rows and asks these functions which of them are due in a tick.
//
// Every time here is Asia/Dhaka, a fixed UTC+6. A tick looks back over a
// catch-up window (now - 5 min, now], so a restart or a slow tick doesn't
// lose a reminder; the bell row's unique key keeps a reminder that two
// ticks both see to one row.

const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export const WINDOW_MINUTES = 5;

// "HH:MM" on a 24-hour clock.
export const CLOCK_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export const NAMAZ_KEYS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;
export type NamazKey = (typeof NAMAZ_KEYS)[number];
export const RAMADAN_KEYS = ['sehri', 'iftar'] as const;
export type RamadanKey = (typeof RAMADAN_KEYS)[number];

// The words a Namaz sheet stores for each prayer (HabitMonthCheck.item).
export const PRAYER_NAMES: Record<NamazKey, string> = { fajr: 'Fajr', dhuhr: 'Dhuhr', asr: 'Asr', maghrib: 'Maghrib', isha: 'Isha' };

export const isNamazKey = (key: string): key is NamazKey => (NAMAZ_KEYS as readonly string[]).includes(key);
export const isRamadanKey = (key: string): key is RamadanKey => (RAMADAN_KEYS as readonly string[]).includes(key);

// The kinds a Reminder row is set on a clock for.
export const TIMED_KINDS = ['HABIT', 'CHALLENGE', 'BOOK', 'SKILL'] as const satisfies readonly ReminderKind[];
export const isTimedKind = (kind: ReminderKind): kind is (typeof TIMED_KINDS)[number] => (TIMED_KINDS as readonly string[]).includes(kind);

const pad = (n: number) => String(n).padStart(2, '0');

// The instant `at`, floored to its minute.
export const floorMinute = (at: Date): Date => new Date(Math.floor(at.getTime() / MINUTE_MS) * MINUTE_MS);

// The Dhaka calendar day ("YYYY-MM-DD"), clock ("HH:MM") and weekday
// (0 = Sunday) of an instant.
export function dhakaParts(at: Date): { day: string; clock: string; weekday: number } {
  const local = new Date(at.getTime() + DHAKA_OFFSET_MS);
  return { day: local.toISOString().slice(0, 10), clock: `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`, weekday: local.getUTCDay() };
}

// The instant a Dhaka day's "HH:MM" happens.
export function dhakaInstant(day: string, clock: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  const [hours, minutes] = clock.split(':').map(Number);
  return new Date(Date.UTC(year, month - 1, date, hours, minutes) - DHAKA_OFFSET_MS);
}

export const weekdayOf = (day: string): number => new Date(`${day}T00:00:00.000Z`).getUTCDay();

export const shiftDay = (day: string, days: number): string => new Date(new Date(`${day}T00:00:00.000Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);

// Whether an instant falls in the tick's window (now - minutes, now].
export function inWindow(at: Date, now: Date, minutes = WINDOW_MINUTES): boolean {
  const end = floorMinute(now).getTime();
  return at.getTime() > end - minutes * MINUTE_MS && at.getTime() <= end;
}

// The Dhaka days the window touches: today, and yesterday too in its
// first minutes.
export function windowDays(now: Date, minutes = WINDOW_MINUTES): string[] {
  const end = floorMinute(now);
  const first = dhakaParts(new Date(end.getTime() - (minutes - 1) * MINUTE_MS)).day;
  const last = dhakaParts(end).day;
  return first === last ? [last] : [first, last];
}

// The "HH:MM" clocks in the window, for narrowing the query.
export function windowClocks(now: Date, minutes = WINDOW_MINUTES): string[] {
  const end = floorMinute(now).getTime();
  return Array.from({ length: minutes }, (_, i) => dhakaParts(new Date(end - i * MINUTE_MS)).clock);
}

// One reminder firing: the Dhaka day and clock it fires at (the bell row's
// key), and the instant.
export interface Fire {
  day: string;
  clock: string;
  at: Date;
}

export function fireOf(at: Date): Fire {
  const { day, clock } = dhakaParts(at);
  return { day, clock, at };
}

// A reminder set on a clock (HABIT/CHALLENGE/BOOK/SKILL): each of its times
// on an allowed weekday (none listed = every day) that falls in the window.
export function timedFires(reminder: { times: string[]; weekdays: number[] }, now: Date, minutes = WINDOW_MINUTES): Fire[] {
  const fires: Fire[] = [];
  for (const day of windowDays(now, minutes)) {
    if (reminder.weekdays.length > 0 && !reminder.weekdays.includes(weekdayOf(day))) continue;
    for (const clock of reminder.times) {
      if (!CLOCK_REGEX.test(clock)) continue;
      const at = dhakaInstant(day, clock);
      if (inWindow(at, now, minutes)) fires.push({ day, clock, at });
    }
  }
  return fires;
}

// A reminder some minutes before a moment (a prayer, Sehri, Iftar, a
// to-do's time), if that falls in the window.
export function beforeFire(moment: Date, minutesBefore: number, now: Date, minutes = WINDOW_MINUTES): Fire | null {
  const at = floorMinute(new Date(moment.getTime() - minutesBefore * MINUTE_MS));
  return inWindow(at, now, minutes) ? fireOf(at) : null;
}

// The days whose to-dos can fire in the window: a task early tomorrow
// with a long lead fires today.
export function todoDays(now: Date, minutes = WINDOW_MINUTES): string[] {
  const days = windowDays(now, minutes);
  return [...days, shiftDay(days[days.length - 1], 1)];
}

// A challenge's day number on a Dhaka day, counted from its day 1 (its
// start date; for an older row the UTC date of createdAt, as the app counts
// it). Null before it begins, once it is over, and after the day it was
// ended early.
export function challengeDay(
  sheet: { createdAt: Date; startsOn: Date | null; totalDays: number | null; endedOnDay: number | null },
  day: string,
): number | null {
  const start = (sheet.startsOn ?? sheet.createdAt).toISOString().slice(0, 10);
  const n = Math.round((new Date(`${day}T00:00:00.000Z`).getTime() - new Date(`${start}T00:00:00.000Z`).getTime()) / DAY_MS) + 1;
  if (n < 1) return null;
  if (sheet.totalDays !== null && n > sheet.totalDays) return null;
  if (sheet.endedOnDay !== null && n > sheet.endedOnDay) return null;
  return n;
}

// The hidden item a challenge with no daily items is ticked through
// (the app's DAY_ITEM).
export const CHALLENGE_DAY_ITEM = 'done';

// Whether a challenge's day is done: every item on it ticked (or the day
// itself, on a challenge with no items of its own).
export function challengeDone(items: string[], ticked: string[]): boolean {
  const needed = items.length > 0 ? items : [CHALLENGE_DAY_ITEM];
  return needed.every((item) => ticked.includes(item));
}

// The bell row's key: one per reminder per firing, so a reminder two ticks
// (or two servers) both see is written, and pushed, once.
export const reminderKey = (kind: ReminderKind, target: string, fire: Fire): string => `reminder:${kind}:${target}:${fire.day}:${fire.clock}`;

// The page a reminder opens (the customer app's routes).
export function reminderUrl(kind: ReminderKind, targetKey: string): string {
  switch (kind) {
    case 'HABIT':
      return '/habit-tracker/daily';
    case 'CHALLENGE':
      return `/habit-tracker/habits/others/${targetKey}`;
    case 'TODO':
      return '/habit-tracker/todos';
    case 'NAMAZ':
      return '/habit-tracker/habits?category=Namaz';
    case 'RAMADAN':
      return '/habit-tracker/habits?category=Ramadan';
    case 'BOOK':
      return '/habit-tracker/habits?category=Book';
    case 'SKILL':
      return '/habit-tracker/habits?category=Course';
  }
}
