import { AdminAuthService } from './admin-auth.service.js';

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1';

const build = (overrides: Record<string, unknown> = {}) => {
  const prisma = {
    authSession: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'phone', ipAddress: '203.0.113.9', userAgent: IPHONE, createdAt: new Date('2026-10-10'), updatedAt: new Date('2026-10-16') },
        { id: 'laptop', ipAddress: '', userAgent: CHROME, createdAt: new Date('2026-10-01'), updatedAt: new Date('2026-10-12') },
      ]),
      count: vi.fn().mockResolvedValue(1),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    ...overrides,
  };
  const sessions = { revokeOthersForUser: vi.fn().mockResolvedValue(undefined) };
  const service = new AdminAuthService(prisma as never, sessions as never, {} as never, {} as never);
  return { prisma, sessions, service };
};

describe('AdminAuthService sessions', () => {
  it('lists the signed-in devices with this one first', async () => {
    const { service } = build();
    const listed = await service.listSessions('admin-1', 'laptop');
    expect(listed.map((session) => [session.id, session.current, session.deviceLabel, session.ipAddress])).toEqual([
      ['laptop', true, 'Chrome on Windows', null],
      ['phone', false, 'Safari on iOS', '203.0.113.9'],
    ]);
  });

  it('signs out the other devices and writes it to the audit log', async () => {
    const { service, sessions, prisma } = build();
    await expect(service.signOutOthers('admin-1', 'laptop', '198.51.100.1')).resolves.toEqual({ signedOut: 1 });
    expect(sessions.revokeOthersForUser).toHaveBeenCalledWith('admin-1', 'laptop');
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('writes nothing to the audit log when there was no other device', async () => {
    const { service, prisma } = build({ authSession: { findMany: vi.fn(), count: vi.fn().mockResolvedValue(0) } });
    await expect(service.signOutOthers('admin-1', 'laptop')).resolves.toEqual({ signedOut: 0 });
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});
