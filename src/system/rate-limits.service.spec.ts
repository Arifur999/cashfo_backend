import { RateLimitsService } from './rate-limits.service.js';

const setup = ({ byEndpoint = [] as object[], offenders = [] as object[], exceeded = 0 } = {}) => {
  const prisma = {
    apiRateLimitLog: {
      groupBy: vi.fn((args: { by: string[] }) => Promise.resolve(args.by.includes('endpoint') ? byEndpoint : offenders)),
      count: vi.fn().mockResolvedValue(exceeded),
    },
  };
  return { service: new RateLimitsService(prisma as never), prisma };
};

describe('RateLimitsService.summary', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }));
  afterEach(() => vi.useRealTimers());

  it.each([
    // 1:30am on 21 October in Dhaka, still the 20th in UTC.
    ['2026-10-20T19:30:00.000Z', '2026-10-20T18:00:00.000Z'],
    // 4pm in Dhaka.
    ['2026-10-21T10:00:00.000Z', '2026-10-20T18:00:00.000Z'],
    // The last moment of the Dhaka day.
    ['2026-10-21T17:59:59.999Z', '2026-10-20T18:00:00.000Z'],
    // Dhaka midnight starts the next day.
    ['2026-10-21T18:00:00.000Z', '2026-10-21T18:00:00.000Z'],
  ])('at %s counts the limits hit since Dhaka midnight, %s', async (now, dayStart) => {
    vi.setSystemTime(new Date(now));
    const { service, prisma } = setup({ exceeded: 4 });
    await expect(service.summary()).resolves.toMatchObject({ exceededToday: 4 });
    expect(prisma.apiRateLimitLog.count).toHaveBeenCalledWith({ where: { limitExceeded: true, windowStart: { gte: new Date(dayStart) } } });
  });

  it('keeps the busiest endpoints and the worst offenders, five of each', async () => {
    vi.setSystemTime(new Date('2026-10-21T10:00:00.000Z'));
    const byEndpoint = ['/a', '/b', '/c', '/d', '/e', '/f'].map((endpoint, i) => ({ endpoint, _sum: { requestCount: i === 5 ? null : (i + 1) * 10 } }));
    const offenders = [3, 9, 1, 7, 5, 2].map((count, i) => ({ identifier: `ip-${i}`, identifierType: 'ip', _count: count }));
    const { service } = setup({ byEndpoint, offenders });
    const summary = await service.summary();
    expect(summary.topEndpoints).toEqual([
      { endpoint: '/e', requestCount: 50 },
      { endpoint: '/d', requestCount: 40 },
      { endpoint: '/c', requestCount: 30 },
      { endpoint: '/b', requestCount: 20 },
      { endpoint: '/a', requestCount: 10 },
    ]);
    expect(summary.topOffenders.map((row) => row.count)).toEqual([9, 7, 5, 3, 2]);
    expect(summary.topOffenders[0]).toEqual({ identifier: 'ip-1', identifierType: 'ip', count: 9 });
  });
});
