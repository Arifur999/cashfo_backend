import { describe, expect, it } from 'vitest';
import { readingSummary } from './reading.js';

// Friday 2 October 2026.
const TODAY = '2026-10-02';

describe('readingSummary', () => {
  it('counts the days in a row up to today, and the best run', () => {
    const days = ['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'].map((date) => ({ date, pages: 10 }));
    expect(readingSummary(days, TODAY)).toMatchObject({ streak: 6, best: 6 });
    expect(readingSummary(days.slice(0, 3), TODAY)).toMatchObject({ streak: 0, best: 3 });
  });

  it("keeps yesterday's streak while today has no pages yet", () => {
    const days = [{ date: '2026-09-30', pages: 5 }, { date: '2026-10-01', pages: 8 }, { date: TODAY, pages: 0 }];
    expect(readingSummary(days, TODAY)).toMatchObject({ streak: 2, best: 2 });
  });

  it('lays out the week from Saturday to Friday', () => {
    const { week } = readingSummary([{ date: '2026-09-27', pages: 18 }, { date: TODAY, pages: 20 }, { date: '2026-09-25', pages: 9 }], TODAY);
    expect(week.map((day) => day.date)).toEqual(['2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
    expect(week.map((day) => day.pages)).toEqual([0, 18, 0, 0, 0, 0, 20]);
    // A Saturday opens its own week.
    expect(readingSummary([], '2026-10-03').week[0].date).toBe('2026-10-03');
  });
});
