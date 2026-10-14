import { AnalyticsService, countryOfIp } from './analytics.service.js';

describe('countryOfIp', () => {
  it('names the country of a public address', () => {
    expect(countryOfIp('103.4.145.1')).toBe('Bangladesh');
    expect(countryOfIp('8.8.8.8')).toBe('United States');
    expect(countryOfIp('::ffff:8.8.8.8')).toBe('United States');
    expect(countryOfIp('2001:4860:4860::8888')).toBe('United States');
  });

  it('says Unknown for what it cannot place', () => {
    expect(countryOfIp('127.0.0.1')).toBe('Unknown');
    expect(countryOfIp('10.0.0.5')).toBe('Unknown');
    expect(countryOfIp('unknown')).toBe('Unknown');
    expect(countryOfIp('x'.repeat(10_000))).toBe('Unknown');
    expect(countryOfIp(null)).toBe('Unknown');
  });
});

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
