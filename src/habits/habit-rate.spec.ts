import { completionRate, plannedCount } from './habit-rate.js';

const created = new Date('2026-01-01T00:00:00.000Z');
const daysBack = (today: string, count: number) =>
  Array.from({ length: count }, (_, i) => new Date(Date.parse(`${today}T00:00:00.000Z`) - i * 86_400_000).toISOString().slice(0, 10));

describe('plannedCount', () => {
  // 2026-09-26 is a Saturday; the seven days run Saturday to Friday.
  const week = ['2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'];

  it('counts every day for a daily habit and only its weekdays for a certain-days one', () => {
    expect(plannedCount({ frequencyType: 'DAILY', weeklyDays: [], weeklyCount: null }, week)).toBe(7);
    // Sunday to Thursday.
    expect(plannedCount({ frequencyType: 'WEEKLY_DAYS', weeklyDays: [0, 1, 2, 3, 4], weeklyCount: null }, week)).toBe(5);
  });

  it('counts N for each week touched, by the chosen week start', () => {
    const habit = { frequencyType: 'WEEKLY_COUNT' as const, weeklyDays: [], weeklyCount: 3 };
    expect(plannedCount(habit, week)).toBe(3);
    // With Monday weeks, Saturday to Friday spans two weeks.
    expect(plannedCount(habit, week, 'MONDAY')).toBe(6);
  });
});

describe('completionRate', () => {
  const today = '2026-10-02';

  it('divides by the planned days, not by 30', () => {
    // Sunday to Thursday, done on every planned day of the last 30.
    const habit = { frequencyType: 'WEEKLY_DAYS' as const, weeklyDays: [0, 1, 2, 3, 4], weeklyCount: null, createdAt: created };
    const done = new Set(daysBack(today, 30).filter((day) => [0, 1, 2, 3, 4].includes(new Date(`${day}T00:00:00Z`).getUTCDay())));
    const result = completionRate(habit, done, today, null);
    expect(result.planned).toBe(done.size);
    expect(result.rate).toBe(100);
  });

  it('counts only from the day the habit started', () => {
    const habit = { frequencyType: 'DAILY' as const, weeklyDays: [], weeklyCount: null, createdAt: new Date('2026-09-23T10:00:00.000Z') };
    const done = new Set(['2026-09-30', '2026-10-01', '2026-10-02']);
    // 23 Sep to 2 Oct: ten days planned, three done.
    expect(completionRate(habit, done, today, null)).toEqual({ planned: 10, done: 3, rate: 30 });
    // An earlier first log moves the start back.
    expect(completionRate(habit, done, today, '2026-09-13').planned).toBe(20);
  });

  it('is null while nothing was planned, and never above 100', () => {
    const habit = { frequencyType: 'WEEKLY_DAYS' as const, weeklyDays: [5], weeklyCount: null, createdAt: new Date('2026-10-02T00:00:00.000Z') };
    // 2 Oct is a Friday (5): planned once.
    expect(completionRate(habit, new Set(), '2026-10-01', null).rate).toBeNull();
    const weekly = { frequencyType: 'WEEKLY_COUNT' as const, weeklyDays: [], weeklyCount: 1, createdAt: new Date('2026-10-01T00:00:00.000Z') };
    expect(completionRate(weekly, new Set(['2026-10-01', '2026-10-02']), today, null).rate).toBe(100);
  });
});
