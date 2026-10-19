import { describe, expect, it } from 'vitest';
import { currentStreak } from './streak.js';

// Friday 2 October 2026. Its week runs Saturday 26 September to today.
const TODAY = '2026-10-02';
const days = (...list: string[]) => new Set(list);

describe('currentStreak', () => {
  it('counts every day of a daily habit, and waits for today', () => {
    const daily = { frequencyType: 'DAILY' as const, weeklyDays: [], weeklyCount: null };
    expect(currentStreak(daily, days('2026-09-30', '2026-10-01', TODAY), TODAY)).toBe(3);
    expect(currentStreak(daily, days('2026-09-30', '2026-10-01'), TODAY)).toBe(2);
    expect(currentStreak(daily, days('2026-09-29', '2026-10-01'), TODAY)).toBe(1);
  });

  it('skips the days a certain-days habit is not planned', () => {
    // Sunday to Thursday; Friday 2 Oct and Saturday 26 Sep are rest days.
    const weekdays = { frequencyType: 'WEEKLY_DAYS' as const, weeklyDays: [0, 1, 2, 3, 4], weeklyCount: null };
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
