import type { Habit } from '@prisma/client';

// A habit's current streak, worked out from the days it was done. Pure.
//
// - Every day: the days done in a row.
// - Certain weekdays: a day that isn't planned is skipped, not a break, so a
//   Sunday-to-Thursday habit keeps its streak over the weekend. (A done
//   unplanned day still counts, as the client's best streak counts it.)
// - N times a week: the weeks in a row (Saturday to Friday) with at least N
//   days done.
// Today never breaks a streak before it is over: it counts once done.

export type StreakHabit = Pick<Habit, 'frequencyType' | 'weeklyDays' | 'weeklyCount'>;

// How far back a streak is followed (and so its largest value).
const LOOK_BACK_DAYS = 730;

const shift = (day: string, by: number): string => new Date(Date.parse(`${day}T00:00:00.000Z`) + by * 86_400_000).toISOString().slice(0, 10);
const weekday = (day: string): number => new Date(`${day}T00:00:00.000Z`).getUTCDay();

// The Saturday that opens the week of `day`.
const weekStart = (day: string): string => shift(day, -((weekday(day) + 1) % 7));

export function currentStreak(habit: StreakHabit, done: ReadonlySet<string>, today: string): number {
  if (habit.frequencyType === 'WEEKLY_COUNT') {
    const need = Math.max(1, habit.weeklyCount ?? 1);
    const doneIn = (saturday: string) => Array.from({ length: 7 }, (_, i) => shift(saturday, i)).filter((day) => day <= today && done.has(day)).length;
    let saturday = weekStart(today);
    let streak = doneIn(saturday) >= need ? 1 : 0;
    for (let i = 0; i < LOOK_BACK_DAYS / 7; i++) {
      saturday = shift(saturday, -7);
      if (doneIn(saturday) < need) break;
      streak++;
    }
    return streak;
  }

  const planned = (day: string) => habit.frequencyType === 'DAILY' || habit.weeklyDays.includes(weekday(day));
  let streak = 0;
  let day = done.has(today) ? today : shift(today, -1);
  for (let i = 0; i < LOOK_BACK_DAYS; i++, day = shift(day, -1)) {
    if (done.has(day)) streak++;
    else if (planned(day)) break;
  }
  return streak;
}
