import { HabitsService } from './habits.service.js';

// Noon in Dhaka on Friday 2 October 2026. Its last 30 days start on 3 Sep.
const NOW = new Date('2026-10-02T06:00:00.000Z');

const habit = (id: string, rule: { frequencyType?: 'DAILY' | 'WEEKLY_DAYS' | 'WEEKLY_COUNT'; weeklyDays?: number[]; weeklyCount?: number | null } = {}) => ({
  id,
  userId: 'user-1',
  name: `Habit ${id}`,
  category: 'Others',
  icon: 'target',
  color: 'blue',
  frequencyType: 'DAILY' as const,
  weeklyDays: [] as number[],
  weeklyCount: null as number | null,
  targetValue: null,
  unit: null,
  isArchived: false,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  ...rule,
});

// A done day, as the query (completed only) returns it.
const log = (habitId: string, day: string) => ({ habitId, date: new Date(`${day}T00:00:00.000Z`) });

// Each habit's first log, as the groupBy returns it.
const firstLogs = (logs: ReturnType<typeof log>[]) =>
  [...new Set(logs.map((l) => l.habitId))].map((habitId) => ({
    habitId,
    _min: { date: logs.filter((l) => l.habitId === habitId).sort((a, b) => a.date.getTime() - b.date.getTime())[0].date },
  }));

const setup = (habits: ReturnType<typeof habit>[], logs: ReturnType<typeof log>[] = [], weekStart = 'SATURDAY') => {
  const prisma = {
    habit: { findMany: vi.fn().mockResolvedValue(habits) },
    habitLog: { findMany: vi.fn().mockResolvedValue(logs), groupBy: vi.fn().mockResolvedValue(firstLogs(logs)) },
    user: { findUnique: vi.fn().mockResolvedValue({ weekStart }) },
  };
  return { service: new HabitsService(prisma as never), prisma };
};

const row = (
  id: string,
  numbers: { currentStreak: number; bestStreak: number; last30DaysCompleted: number; last30DaysPlanned: number; completionRate: number | null },
) => ({
  habitId: id,
  name: `Habit ${id}`,
  icon: 'target',
  color: 'blue',
  ...numbers,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('HabitsService.getStats', () => {
  it("adds each habit's best streak over its whole history, reading the logs once for every habit", async () => {
    const { service, prisma } = setup(
      [habit('h1'), habit('h2', { frequencyType: 'WEEKLY_COUNT', weeklyCount: 2 }), habit('h3')],
      [
        // Seven days in March, long before the last 60 days, then the current three.
        ...[1, 2, 3, 4, 5, 6, 7].map((day) => log('h1', `2026-03-0${day}`)),
        log('h1', '2026-09-30'),
        log('h1', '2026-10-01'),
        log('h1', '2026-10-02'),
        // Twice in the weeks of 5 and 12 Sep, once in the week of 19 Sep, and
        // twice so far this week (from 26 Sep).
        ...['2026-09-05', '2026-09-06', '2026-09-12', '2026-09-18', '2026-09-20', '2026-09-26', '2026-10-01'].map((day) => log('h2', day)),
      ],
    );

    await expect(service.getStats('user-1')).resolves.toEqual([
      row('h1', { currentStreak: 3, bestStreak: 7, last30DaysCompleted: 3, last30DaysPlanned: 30, completionRate: 10 }),
      // Weeks, like its current streak. Twice a week over the five weeks the
      // last 30 days touch: 10 planned, 7 done.
      row('h2', { currentStreak: 1, bestStreak: 2, last30DaysCompleted: 7, last30DaysPlanned: 10, completionRate: 70 }),
      row('h3', { currentStreak: 0, bestStreak: 0, last30DaysCompleted: 0, last30DaysPlanned: 30, completionRate: 0 }),
    ]);
    expect(prisma.habit.findMany).toHaveBeenCalledWith({ where: { userId: 'user-1', isArchived: false }, orderBy: { createdAt: 'asc' } });
    expect(prisma.habitLog.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.habitLog.findMany).toHaveBeenCalledWith({
      where: { habitId: { in: ['h1', 'h2', 'h3'] }, completed: true },
      select: { habitId: true, date: true },
    });
  });

  it('counts the last 30 days as before', async () => {
    // 3 Sep is the 30th day back and counts; 2 Sep doesn't. A day logged
    // ahead of today always counted in last30DaysCompleted and still does,
    // though no streak -- and not the rate -- counts it.
    const { service } = setup([habit('h1')], [log('h1', '2026-09-02'), log('h1', '2026-09-03'), log('h1', '2026-10-05')]);
    await expect(service.getStats('user-1')).resolves.toEqual([
      row('h1', { currentStreak: 0, bestStreak: 2, last30DaysCompleted: 2, last30DaysPlanned: 30, completionRate: 3 }),
    ]);
  });

  it('takes today from the Dhaka calendar, not UTC', async () => {
    // 01:00 on Friday 2 Oct in Dhaka, still Thursday 1 Oct in UTC. A UTC
    // today would leave 2 Oct out of both streaks (2, not 3) and bring 2 Sep
    // into the last 30 days (4 days, 13%).
    vi.setSystemTime(new Date('2026-10-01T19:00:00.000Z'));
    const { service } = setup(
      [habit('h1')],
      ['2026-09-02', '2026-09-30', '2026-10-01', '2026-10-02'].map((day) => log('h1', day)),
    );
    await expect(service.getStats('user-1')).resolves.toEqual([
      row('h1', { currentStreak: 3, bestStreak: 3, last30DaysCompleted: 3, last30DaysPlanned: 30, completionRate: 10 }),
    ]);
  });

  it('rates a certain-days habit against its planned days, from the day it was added', async () => {
    // Sunday to Thursday, added on Wednesday 23 Sep, done on every planned
    // day since: 23, 24, 27, 28, 29, 30 Sep and 1 Oct. Dividing by 30 read 23%.
    const days = ['2026-09-23', '2026-09-24', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01'];
    const { service } = setup(
      [{ ...habit('h1', { frequencyType: 'WEEKLY_DAYS', weeklyDays: [0, 1, 2, 3, 4] }), createdAt: new Date('2026-09-23T04:00:00.000Z') }],
      days.map((day) => log('h1', day)),
    );
    const [stats] = await service.getStats('user-1');
    expect(stats).toMatchObject({ last30DaysCompleted: 7, last30DaysPlanned: 7, completionRate: 100 });
  });

  it("counts an N-times-a-week habit's weeks from the customer's week start", async () => {
    // Twice a week, on Saturday 3 Oct: the last 30 days run from Friday 4 Sep,
    // so with Saturday weeks they touch six weeks (from 29 Aug), with Monday
    // weeks five (from 31 Aug).
    vi.setSystemTime(new Date('2026-10-03T06:00:00.000Z'));
    const logs = ['2026-09-28', '2026-09-29'].map((day) => log('h1', day));
    const weekly = habit('h1', { frequencyType: 'WEEKLY_COUNT', weeklyCount: 2 });
    const saturday = await setup([weekly], logs).service.getStats('user-1');
    const monday = await setup([weekly], logs, 'MONDAY').service.getStats('user-1');
    expect(saturday[0]).toMatchObject({ last30DaysPlanned: 12, completionRate: 17 });
    expect(monday[0]).toMatchObject({ last30DaysPlanned: 10, completionRate: 20 });
  });

  it('reads no logs for a user with no habits', async () => {
    const { service, prisma } = setup([]);
    await expect(service.getStats('user-1')).resolves.toEqual([]);
    expect(prisma.habitLog.findMany).not.toHaveBeenCalled();
  });
});

describe('HabitsService.getToday', () => {
  it('still carries the current streak of each habit planned today', async () => {
    const todayLog = { id: 'log-1', habitId: 'h1', date: new Date('2026-10-02T00:00:00.000Z'), completed: true, value: null, note: null };
    const { service, prisma } = setup([habit('h1')]);
    prisma.habitLog.findMany.mockResolvedValueOnce([todayLog]).mockResolvedValueOnce([log('h1', '2026-10-01'), log('h1', '2026-10-02')]);

    const [today] = await service.getToday('user-1');
    expect(today).toMatchObject({ id: 'h1', todayLog, streak: 2 });
    expect(prisma.habitLog.findMany).toHaveBeenLastCalledWith({ where: { habitId: { in: ['h1'] }, completed: true }, select: { habitId: true, date: true } });
  });
});

describe('HabitsService.getMonthsLogs', () => {
  const setupRange = () => {
    const prisma = { habit: { findMany: vi.fn().mockResolvedValue([habit('h1')]) }, habitLog: { findMany: vi.fn().mockResolvedValue([]) } };
    return { service: new HabitsService(prisma as never), prisma };
  };

  it('reads every log from the first month through the last', async () => {
    const { service, prisma } = setupRange();
    await service.getMonthsLogs('user-1', '2025-11', '2026-10');
    expect(prisma.habitLog.findMany.mock.calls[0][0].where.date).toEqual({
      gte: new Date('2025-11-01T00:00:00.000Z'),
      lt: new Date('2026-11-01T00:00:00.000Z'),
    });
  });

  it('refuses a run backwards or longer than two years', async () => {
    const { service } = setupRange();
    await expect(service.getMonthsLogs('user-1', '2026-10', '2026-09')).rejects.toThrow('from must not be after to');
    await expect(service.getMonthsLogs('user-1', '2024-01', '2026-01')).rejects.toThrow('At most 24 months');
  });
});
