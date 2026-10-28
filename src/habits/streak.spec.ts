import { describe, expect, it } from 'vitest';
import { bestStreak, currentStreak, type StreakHabit } from './streak.js';

// Friday 2 October 2026. Its week runs Saturday 26 September to today.
const TODAY = '2026-10-02';
const days = (...list: string[]) => new Set(list);
const addDays = (day: string, by: number) => new Date(Date.parse(`${day}T00:00:00.000Z`) + by * 86_400_000).toISOString().slice(0, 10);
const weekdayOf = (day: string) => new Date(`${day}T00:00:00.000Z`).getUTCDay();

const daily = { frequencyType: 'DAILY' as const, weeklyDays: [], weeklyCount: null };
// Sunday to Thursday; Friday and Saturday are rest days.
const weekdays = { frequencyType: 'WEEKLY_DAYS' as const, weeklyDays: [0, 1, 2, 3, 4], weeklyCount: null };

describe('currentStreak', () => {
  it('counts every day of a daily habit, and waits for today', () => {
    expect(currentStreak(daily, days('2026-09-30', '2026-10-01', TODAY), TODAY)).toBe(3);
    expect(currentStreak(daily, days('2026-09-30', '2026-10-01'), TODAY)).toBe(2);
    expect(currentStreak(daily, days('2026-09-29', '2026-10-01'), TODAY)).toBe(1);
  });

  it('skips the days a certain-days habit is not planned', () => {
    // Friday 2 Oct and Saturday 26 Sep are rest days.
    const done = days('2026-09-24', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01');
    expect(currentStreak(weekdays, done, TODAY)).toBe(6);
    // Missing Thursday 24 Sep, a planned day, ends it there.
    done.delete('2026-09-24');
    expect(currentStreak(weekdays, done, TODAY)).toBe(5);
  });

  it('counts the weeks an N-times-a-week habit met its count', () => {
    const thrice = { frequencyType: 'WEEKLY_COUNT' as const, weeklyDays: [], weeklyCount: 3 };
    const done = days('2026-09-12', '2026-09-15', '2026-09-17', '2026-09-19', '2026-09-20', '2026-09-24', '2026-09-27', '2026-09-30');
    // This week has two so far: it doesn't count yet, nor break the run.
    expect(currentStreak(thrice, done, TODAY)).toBe(2);
    done.add(TODAY);
    expect(currentStreak(thrice, done, TODAY)).toBe(3);
  });
});

// The calendar walk the client's best streak does, every day (or week) from
// `from` to today, oldest first -- to check bestStreak's walk over the done
// days alone against.
function walkedBest(habit: StreakHabit, done: ReadonlySet<string>, from: string, today: string): number {
  let best = 0;
  let run = 0;
  if (habit.frequencyType === 'WEEKLY_COUNT') {
    const need = Math.max(1, habit.weeklyCount ?? 1);
    for (let saturday = addDays(from, -((weekdayOf(from) + 1) % 7)); saturday <= today; saturday = addDays(saturday, 7)) {
      const count = Array.from({ length: 7 }, (_, i) => addDays(saturday, i)).filter((day) => day <= today && done.has(day)).length;
      run = count >= need ? run + 1 : 0;
      best = Math.max(best, run);
    }
    return best;
  }
  for (let day = from; day <= today; day = addDays(day, 1)) {
    if (done.has(day)) run++;
    else if (habit.frequencyType === 'DAILY' || habit.weeklyDays.includes(weekdayOf(day))) run = 0;
    best = Math.max(best, run);
  }
  return best;
}

describe('bestStreak', () => {
  it('finds the longest run in the whole history, not only the current one', () => {
    // Five days in March, long before the last 60 days, then the current three.
    const done = days('2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-09-30', '2026-10-01', TODAY);
    expect(bestStreak(daily, done, TODAY)).toBe(5);
    expect(currentStreak(daily, done, TODAY)).toBe(3);
  });

  it('counts the run still going, which today does not end before it is over', () => {
    const done = days('2026-09-28', '2026-09-30', '2026-10-01');
    expect(bestStreak(daily, done, TODAY)).toBe(2);
    done.add(TODAY);
    expect(bestStreak(daily, done, TODAY)).toBe(3);
  });

  it("has no look-back limit, so it is never below the current streak's", () => {
    // 800 days in a row up to today; the current streak stops at 730.
    const run = new Set(Array.from({ length: 800 }, (_, i) => addDays(TODAY, -i)));
    expect(currentStreak(daily, run, TODAY)).toBe(730);
    expect(bestStreak(daily, run, TODAY)).toBe(800);
  });

  it('ignores days logged after today, as the current streak does', () => {
    expect(bestStreak(daily, days('2026-10-01', TODAY, '2026-10-03', '2026-10-04'), TODAY)).toBe(2);
    expect(bestStreak(daily, days(), TODAY)).toBe(0);
  });

  it('skips the days a certain-days habit is not planned', () => {
    // Thursday 17 Sep, then Sunday 20 to Thursday 24 Sep over the weekend: 6.
    // Sunday 27 Sep, a planned day, was missed.
    const done = days('2026-09-17', '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-28');
    expect(bestStreak(weekdays, done, TODAY)).toBe(6);
    // A rest day done (Friday 25 Sep) counts too.
    done.add('2026-09-25');
    expect(bestStreak(weekdays, done, TODAY)).toBe(7);
  });

  it('breaks on a planned day missed anywhere in a gap of a week or more', () => {
    const fridays = { frequencyType: 'WEEKLY_DAYS' as const, weeklyDays: [5], weeklyCount: null };
    // Friday 11 Sep, then Saturday 19 Sep: Friday 18 Sep, the 7th day between, was missed.
    expect(bestStreak(fridays, days('2026-09-11', '2026-09-19'), TODAY)).toBe(1);
    // Nothing planned at all: nothing ever breaks.
    const never = { frequencyType: 'WEEKLY_DAYS' as const, weeklyDays: [], weeklyCount: null };
    expect(bestStreak(never, days('2026-08-01', '2026-09-19', TODAY), TODAY)).toBe(3);
  });

  it('counts the most weeks in a row an N-times-a-week habit met its count', () => {
    const twice = { frequencyType: 'WEEKLY_COUNT' as const, weeklyDays: [], weeklyCount: 2 };
    // Met in the weeks of 29 Aug, 5 Sep and 12 Sep; once only in the week of
    // 19 Sep; met again this week.
    const done = days('2026-08-29', '2026-09-01', '2026-09-05', '2026-09-06', '2026-09-12', '2026-09-18', '2026-09-20', '2026-09-26', '2026-10-01');
    expect(bestStreak(twice, done, TODAY)).toBe(3);
    expect(currentStreak(twice, done, TODAY)).toBe(1);
  });

  it('agrees with walking the calendar day by day', () => {
    // Park-Miller: the same "random" logs on every run.
    let seed = 20261002;
    const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    const from = addDays(TODAY, -120);
    for (let trial = 0; trial < 600; trial++) {
      // Few planned weekdays and sparse logs too, for long gaps between done days.
      const pick = random() < 0.5 ? 0.2 : 0.6;
      const habit: StreakHabit = [
        daily,
        { frequencyType: 'WEEKLY_DAYS' as const, weeklyDays: [0, 1, 2, 3, 4, 5, 6].filter(() => random() < pick), weeklyCount: null },
        { frequencyType: 'WEEKLY_COUNT' as const, weeklyDays: [], weeklyCount: 1 + Math.floor(random() * 7) },
      ][trial % 3];
      const rate = [0.1, 0.3, 0.6, 0.85, 0.97][Math.floor(trial / 3) % 5];
      const done = new Set<string>();
      // A few days past today too, which neither walk counts.
      for (let day = from; day <= addDays(TODAY, 10); day = addDays(day, 1)) if (random() < rate) done.add(day);

      const best = bestStreak(habit, done, TODAY);
      expect(best).toBe(walkedBest(habit, done, from, TODAY));
      expect(best).toBeGreaterThanOrEqual(currentStreak(habit, done, TODAY));
    }
  });
});

describe("the customer's week start", () => {
  // Twice a week. 2 Oct 2026 is a Friday.
  const habit: StreakHabit = { frequencyType: 'WEEKLY_COUNT', weeklyDays: [], weeklyCount: 2 };
  // Sunday 27 Sep and Monday 28 Sep, then Wednesday 30 Sep.
  const done = new Set(['2026-09-27', '2026-09-28', '2026-09-30']);

  it('groups the days by the week the customer chose', () => {
    // Saturday weeks: 26 Sep - 2 Oct holds all three.
    expect(currentStreak(habit, done, '2026-10-02')).toBe(1);
    // Monday weeks: 28 Sep - 4 Oct has two (met); 21 - 27 Sep has one.
    expect(currentStreak(habit, done, '2026-10-02', 'MONDAY')).toBe(1);
    expect(bestStreak(habit, new Set(['2026-09-26', '2026-09-27', '2026-10-03', '2026-10-04']), '2026-10-04', 'SUNDAY')).toBe(1);
    // With Saturday weeks those four days are two met weeks in a row.
    expect(bestStreak(habit, new Set(['2026-09-26', '2026-09-27', '2026-10-03', '2026-10-04']), '2026-10-04')).toBe(2);
  });
});
