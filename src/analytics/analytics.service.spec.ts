import { AnalyticsService } from './analytics.service.js';

describe('AnalyticsService.geography', () => {
  it('counts sign-ins and distinct customers per country', async () => {
    const prisma = {
      userSession: {
        findMany: vi.fn().mockResolvedValue([
          { userId: 'a', ipAddress: '103.4.145.1' },
          { userId: 'a', ipAddress: '103.4.145.2' },
          { userId: 'b', ipAddress: '103.4.145.1' },
          { userId: 'c', ipAddress: '8.8.8.8' },
          { userId: 'd', ipAddress: '127.0.0.1' },
          { userId: 'e', ipAddress: '10.0.0.1' },
          { userId: 'f', ipAddress: '10.0.0.2' },
        ]),
      },
    };
    const service = new AnalyticsService(prisma as never);
    await expect(service.geography()).resolves.toEqual({
      countries: [
        { country: 'Bangladesh', eventCount: 3, userCount: 2 },
        { country: 'United States', eventCount: 1, userCount: 1 },
        { country: 'Unknown', eventCount: 3, userCount: 3 },
      ],
      totalUsers: 6,
      cities: [],
    });
  });

  it('counts a customer seen in two countries once in the total', async () => {
    const prisma = {
      userSession: {
        findMany: vi.fn().mockResolvedValue([
          { userId: 'a', ipAddress: '103.4.145.1' },
          { userId: 'a', ipAddress: '8.8.8.8' },
          { userId: 'a', ipAddress: '10.0.0.1' },
          { userId: 'b', ipAddress: '103.4.145.2' },
        ]),
      },
    };
    const geography = await new AnalyticsService(prisma as never).geography();
    expect(geography.countries.map((entry) => [entry.country, entry.userCount])).toEqual([
      ['Bangladesh', 2],
      ['United States', 1],
      ['Unknown', 1],
    ]);
    // The countries' userCounts add up to 4; there are two people.
    expect(geography.totalUsers).toBe(2);
  });

  it('has a total of 0 before anyone signs in', async () => {
    const prisma = { userSession: { findMany: vi.fn().mockResolvedValue([]) } };
    await expect(new AnalyticsService(prisma as never).geography()).resolves.toEqual({ countries: [], totalUsers: 0, cities: [] });
  });
});

describe('AnalyticsService.summary', () => {
  it('counts distinct customers active in each window and yesterday in Dhaka', async () => {
    // 2026-10-17 12:00 in Dhaka.
    const now = new Date('2026-10-17T06:00:00Z');
    const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const prisma = {
      userSession: {
        findMany: vi.fn().mockResolvedValue([
          { userId: 'a', createdAt: daysAgo(20), lastUsedAt: daysAgo(1) },
          { userId: 'a', createdAt: daysAgo(3), lastUsedAt: daysAgo(3) },
          { userId: 'b', createdAt: daysAgo(10), lastUsedAt: daysAgo(9) },
          { userId: 'c', createdAt: daysAgo(25), lastUsedAt: daysAgo(25) },
        ]),
      },
      user: { count: vi.fn().mockResolvedValue(12) },
    };
    const service = new AnalyticsService(prisma as never);
    await expect(service.summary(now)).resolves.toEqual({
      activeLast30d: 3,
      activeLast7d: 1,
      activePrevious7d: 1,
      activeYesterday: 1,
      totalAccounts: 12,
    });
  });
});

describe('AnalyticsService with a period', () => {
  const at = (iso: string) => new Date(iso);

  it("counts a period's active people, its last seven days against the seven before, and its last day", async () => {
    const prisma = {
      userSession: {
        findMany: vi.fn().mockResolvedValue([
          // 30 Sep in Dhaka (the last day) and 5 Sep.
          { userId: 'a', createdAt: at('2026-09-30T04:00:00.000Z'), lastUsedAt: at('2026-09-30T04:00:00.000Z') },
          { userId: 'b', createdAt: at('2026-09-05T04:00:00.000Z'), lastUsedAt: at('2026-09-05T04:00:00.000Z') },
          // 20 Sep: the week before the last seven days.
          { userId: 'c', createdAt: at('2026-09-20T04:00:00.000Z'), lastUsedAt: at('2026-09-20T04:00:00.000Z') },
          // August: before the period.
          { userId: 'd', createdAt: at('2026-08-20T04:00:00.000Z'), lastUsedAt: at('2026-08-31T04:00:00.000Z') },
        ]),
      },
      user: { count: vi.fn().mockResolvedValue(10) },
    };
    const service = new AnalyticsService(prisma as never);
    await expect(service.periodSummary({ from: '2026-09-01', to: '2026-09-30' }, at('2026-10-28T06:00:00.000Z'))).resolves.toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
      isNow: false,
      lastDay: '2026-09-30',
      activeInPeriod: 3,
      activeLast7d: 1,
      activePrevious7d: 1,
      activeLastDay: 1,
      accounts: 10,
    });
  });

  it('reads a running period up to now, with yesterday as its last day', async () => {
    const prisma = { userSession: { findMany: vi.fn().mockResolvedValue([]) }, user: { count: vi.fn().mockResolvedValue(0) } };
    const service = new AnalyticsService(prisma as never);
    await expect(service.periodSummary({ from: '2026-10-01', to: '2026-10-31' }, at('2026-10-28T06:00:00.000Z'))).resolves.toMatchObject({
      to: '2026-10-28',
      isNow: true,
      lastDay: '2026-10-27',
    });
  });

  it('gives a month an average day and everyone active in it', async () => {
    const prisma = {
      userSession: {
        findMany: vi.fn().mockResolvedValue([
          { userId: 'a', createdAt: at('2026-09-01T04:00:00.000Z'), lastUsedAt: at('2026-09-02T04:00:00.000Z') },
          { userId: 'b', createdAt: at('2026-09-02T04:00:00.000Z'), lastUsedAt: at('2026-10-01T04:00:00.000Z') },
        ]),
      },
    };
    const service = new AnalyticsService(prisma as never);
    const rows = await service.engagement({ from: '2026-09-01', to: '2026-10-31', group: 'month' });
    // September: 1 + 2 people over 30 days rounds to 0; three distinct visits, two people.
    expect(rows).toEqual([
      { month: '2026-09', avgDau: 0, mau: 2 },
      { month: '2026-10', avgDau: 0, mau: 1 },
    ]);
  });

  it('lists the six monthly groups up to the period, never the running month', async () => {
    const users = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].map((month, i) => ({
      id: `u${i}`,
      createdAt: at(`${month}-10T04:00:00.000Z`),
    }));
    const prisma = { user: { findMany: vi.fn().mockResolvedValue(users) }, userSession: { findMany: vi.fn().mockResolvedValue([]) } };
    const service = new AnalyticsService(prisma as never);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at('2026-10-28T06:00:00.000Z'));
    try {
      expect((await service.cohorts({ to: '2026-10-31' })).map((row) => row.cohortMonth)).toEqual([
        '2026-04',
        '2026-05',
        '2026-06',
        '2026-07',
        '2026-08',
        '2026-09',
      ]);
      expect((await service.cohorts({ to: '2026-06-30' })).map((row) => row.cohortMonth)).toEqual(['2026-03', '2026-04', '2026-05', '2026-06']);
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts a period's sign-ins by device", async () => {
    const findMany = vi.fn().mockResolvedValue([{ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' }]);
    const service = new AnalyticsService({ userSession: { findMany } } as never);
    await service.devices({ from: '2026-10-01', to: '2026-10-31' });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { createdAt: { gte: at('2026-09-30T18:00:00.000Z'), lt: at('2026-10-31T18:00:00.000Z') } } }),
    );
  });
});
