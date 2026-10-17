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
      cities: [],
    });
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
