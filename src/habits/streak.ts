import type { Habit } from '@prisma/client';

// A habit's current and best streaks, worked out from the days it was done.
// Pure.
//
// - Every day: the days done in a row.
// - Certain weekdays: a day that isn't planned is skipped, not a break, so a
//   Sunday-to-Thursday habit keeps its streak over the weekend. (A done
//   unplanned day still counts, as the client's best streak counts it.)
// - N times a week: the weeks in a row (Saturday to Friday) with at least N
//   days done.
// Today never breaks a streak before it is over: it counts once done.

export type StreakHabit = Pick<Habit, 'frequencyType' | 'weeklyDays' | 'weeklyCount'>;

// How far back a current streak is followed (and so its largest value). The
// best streak has no such limit.
const LOOK_BACK_DAYS = 730;

const DAY_MS = 86_400_000;

const shift = (day: string, by: number): string => new Date(Date.parse(`${day}T00:00:00.000Z`) + by * DAY_MS).toISOString().slice(0, 10);
const weekday = (day: string): number => new Date(`${day}T00:00:00.000Z`).getUTCDay();

// The Saturday that opens the week of `day`.
const weekStart = (day: string): string => shift(day, -((weekday(day) + 1) % 7));

// A daily or certain-days habit's planned days: a planned day left undone
// breaks its streak; any other undone day is skipped.
const planned = (habit: StreakHabit, day: string): boolean => habit.frequencyType === 'DAILY' || habit.weeklyDays.includes(weekday(day));

// How many days an N-times-a-week habit needs in a week.
const weeklyNeed = (habit: StreakHabit): number => Math.max(1, habit.weeklyCount ?? 1);

export function currentStreak(habit: StreakHabit, done: ReadonlySet<string>, today: string): number {
  if (habit.frequencyType === 'WEEKLY_COUNT') {
    const need = weeklyNeed(habit);
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

  let streak = 0;
  let day = done.has(today) ? today : shift(today, -1);
  for (let i = 0; i < LOOK_BACK_DAYS; i++, day = shift(day, -1)) {
    if (done.has(day)) streak++;
    else if (planned(habit, day)) break;
  }
  return streak;
}

// Whether a planned day falls strictly between two consecutive done days
// `from` < `to` (every day between them was left undone): the break
// currentStreak stops at. Weekdays repeat, so a gap of a week or more is
// decided by its first seven days.
function brokenBetween(habit: StreakHabit, from: string, to: string): boolean {
  const gap = (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS - 1;
  for (let i = 1; i <= Math.min(gap, 7); i++) {
    if (planned(habit, shift(from, i))) return true;
  }
  return false;
}

// The longest streak the habit ever had, by the same rules and in the same
// unit as currentStreak (weeks for N times a week, days otherwise), over
// every day it was done up to today. A day logged after today is ignored, as
// currentStreak ignores it. The run still going counts too, without
// currentStreak's look-back limit, so this is never less than it.
//
// Walks the done days (or met weeks) rather than the calendar, so its cost is
// the number of logs, however far back the first one is.
export function bestStreak(habit: StreakHabit, done: ReadonlySet<string>, today: string): number {
  const days = [...done].filter((day) => day <= today).sort();

  if (habit.frequencyType === 'WEEKLY_COUNT') {
    const need = weeklyNeed(habit);
    // Oldest week first: the days are sorted, so the Map's order is the weeks'.
    const perWeek = new Map<string, number>();
    for (const day of days) {
      const saturday = weekStart(day);
      perWeek.set(saturday, (perWeek.get(saturday) ?? 0) + 1);
    }
    let best = 0;
    let run = 0;
    let previous: string | undefined;
    for (const [saturday, count] of perWeek) {
      if (count < need) continue;
      // A week short of its count, or with nothing done, sits between two
      // met weeks that are then more than a week apart.
      run = previous !== undefined && shift(previous, 7) === saturday ? run + 1 : 1;
      previous = saturday;
      best = Math.max(best, run);
    }
    return best;
  }

  let best = 0;
  let run = 0;
  let previous: string | undefined;
  for (const day of days) {
    run = previous !== undefined && !brokenBetween(habit, previous, day) ? run + 1 : 1;
    previous = day;
    best = Math.max(best, run);
  }
  return best;
}
