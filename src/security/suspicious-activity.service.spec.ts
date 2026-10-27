import { LAST_CHECK_KEY, LOCATION_WATERMARK_KEY, SuspiciousActivityService } from './suspicious-activity.service.js';

// 103.4.145.1 is in Bangladesh, 8.8.8.8 in the United States (the bundled
// country database); 10.0.0.1 is a private address nobody can place.
const BD_IP = '103.4.145.1';
const US_IP = '8.8.8.8';
const now = new Date('2026-10-28T06:00:00.000Z');
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60 * 1000);

const setup = ({
  watermark = null as string | null,
  signIns = [] as { email: string; ipAddress: string; createdAt: Date }[],
  history = [] as { email: string; ipAddress: string }[],
  accounts = [{ id: 'u1', name: 'Tanzila Haque', email: 'tanzila@example.com' }],
  lastCheck = null as string | null,
} = {}) => {
  const prisma = {
    platformSetting: {
      findUnique: vi.fn(({ where }: { where: { key: string } }) => {
        if (where.key === LOCATION_WATERMARK_KEY) return Promise.resolve(watermark ? { value: watermark } : null);
        if (where.key === LAST_CHECK_KEY) return Promise.resolve(lastCheck ? { value: lastCheck } : null);
        return Promise.resolve(null);
      }),
      upsert: vi.fn(),
    },
    loginAttempt: {
      findMany: vi.fn(({ where }: { where: { success: boolean; createdAt: { gt?: Date } } }) => Promise.resolve(where.createdAt.gt ? signIns : history)),
    },
    user: { findMany: vi.fn().mockResolvedValue(accounts) },
    suspiciousActivityFlag: {
      createMany: vi.fn(({ data }: { data: unknown[] }) => Promise.resolve({ count: data.length })),
      count: vi.fn().mockResolvedValue(2),
    },
    auditLog: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  return { service: new SuspiciousActivityService(prisma as never), prisma };
};

describe('SuspiciousActivityService.detectUnusualLocations', () => {
  it('flags a sign-in from a country the account never signed in from', async () => {
    const { service, prisma } = setup({
      signIns: [{ email: 'Tanzila@example.com', ipAddress: US_IP, createdAt: minutesAgo(10) }],
      history: [{ email: 'tanzila@example.com', ipAddress: BD_IP }],
    });
    await expect(service.detectUnusualLocations(now)).resolves.toEqual({ signInsChecked: 1, flagsCreated: 1 });
    expect(prisma.suspiciousActivityFlag.createMany).toHaveBeenCalledWith({
      data: [
        {
          type: 'UNUSUAL_LOGIN_LOCATION',
          description:
            'Tanzila Haque (tanzila@example.com) signed in from United States, a country this account has never signed in from before. Earlier sign-ins: Bangladesh.',
          relatedUserId: 'u1',
          relatedIp: US_IP,
          severity: 'MEDIUM',
          status: 'OPEN',
          dedupeKey: 'location:u1:US',
        },
      ],
      skipDuplicates: true,
    });
    // The first run looked back an hour, and moves the watermark to now.
    expect(prisma.loginAttempt.findMany.mock.calls[0][0]).toMatchObject({ where: { success: true, createdAt: { gt: minutesAgo(60), lte: now } } });
    expect(prisma.platformSetting.upsert).toHaveBeenCalledWith({
      where: { key: LOCATION_WATERMARK_KEY },
      update: { value: now.toISOString() },
      create: { key: LOCATION_WATERMARK_KEY, value: now.toISOString() },
    });
  });

  it('stays quiet for a known country, an unplaceable address, or no history to compare', async () => {
    const known = setup({
      watermark: minutesAgo(5).toISOString(),
      signIns: [
        { email: 'tanzila@example.com', ipAddress: BD_IP, createdAt: minutesAgo(3) },
        { email: 'tanzila@example.com', ipAddress: '10.0.0.1', createdAt: minutesAgo(2) },
      ],
      history: [{ email: 'tanzila@example.com', ipAddress: BD_IP }],
    });
    await expect(known.service.detectUnusualLocations(now)).resolves.toEqual({ signInsChecked: 2, flagsCreated: 0 });
    expect(known.prisma.loginAttempt.findMany.mock.calls[0][0]).toMatchObject({ where: { createdAt: { gt: minutesAgo(5) } } });

    const fresh = setup({ signIns: [{ email: 'tanzila@example.com', ipAddress: US_IP, createdAt: minutesAgo(3) }] });
    await expect(fresh.service.detectUnusualLocations(now)).resolves.toEqual({ signInsChecked: 1, flagsCreated: 0 });
    expect(fresh.prisma.suspiciousActivityFlag.createMany).not.toHaveBeenCalled();
  });

  it('only looks at active customer accounts', async () => {
    const { service, prisma } = setup({ signIns: [{ email: 'tanzila@example.com', ipAddress: US_IP, createdAt: minutesAgo(3) }], accounts: [] });
    await service.detectUnusualLocations(now);
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { email: { in: ['tanzila@example.com'] }, role: 'USER', status: 'ACTIVE' },
      select: { id: true, name: true, email: true },
    });
    expect(prisma.suspiciousActivityFlag.createMany).not.toHaveBeenCalled();
  });
});

describe('SuspiciousActivityService.summary', () => {
  it("takes the timer's last run when it is newer than the last Check now", async () => {
    const { service, prisma } = setup({ lastCheck: minutesAgo(2).toISOString() });
    prisma.auditLog.findFirst.mockResolvedValue({ createdAt: minutesAgo(30) });
    await expect(service.summary()).resolves.toEqual({ needsLook: 2, lastCheckedAt: minutesAgo(2) });
  });
});
