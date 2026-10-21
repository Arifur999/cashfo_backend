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
