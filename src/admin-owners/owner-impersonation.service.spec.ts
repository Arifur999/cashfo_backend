import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OwnerImpersonationService } from './owner-impersonation.service.js';

const setup = ({ owner = { id: 'user-1', status: 'ACTIVE' } as { id: string; status: string } | null, views = [] as { id: string }[] } = {}) => {
  const prisma = {
    user: { findUnique: vi.fn().mockResolvedValue(owner) },
    authSession: { update: vi.fn((args) => args), findMany: vi.fn().mockResolvedValue(views) },
    auditLog: { create: vi.fn((args) => args) },
    $transaction: vi.fn().mockResolvedValue([]),
  };
  const sessions = { create: vi.fn().mockResolvedValue('session-9'), revoke: vi.fn() };
  const tokens = { issue: vi.fn().mockReturnValue({ accessToken: 'access', refreshToken: 'refresh' }) };
  const service = new OwnerImpersonationService(prisma as never, sessions as never, tokens as never);
  return { service, prisma, sessions, tokens };
};

describe('OwnerImpersonationService.start', () => {
  it('opens a customer session marked with the admin, for an hour, and logs it', async () => {
    const { service, prisma, sessions, tokens } = setup();
    const before = Date.now();
    const result = await service.start('user-1', 'admin-1', { ipAddress: '203.0.113.5', userAgent: 'Chrome' });

    expect(sessions.create).toHaveBeenCalledWith('user-1', { ipAddress: '203.0.113.5', userAgent: 'Chrome' });
    const update = prisma.authSession.update.mock.calls[0][0];
    expect(update).toMatchObject({ where: { id: 'session-9' }, data: { impersonatedBy: 'admin-1' } });
    expect(update.data.expiresAt.getTime() - before).toBeGreaterThanOrEqual(60 * 60 * 1000 - 1000);
    expect(update.data.expiresAt.getTime() - before).toBeLessThanOrEqual(60 * 60 * 1000 + 1000);
    expect(prisma.auditLog.create.mock.calls[0][0]).toMatchObject({
      data: { adminUserId: 'admin-1', action: 'USER_IMPERSONATION_STARTED', entityType: 'User', entityId: 'user-1' },
    });
    expect(tokens.issue).toHaveBeenCalledWith('user', { sub: 'user-1', sid: 'session-9', role: 'USER' });
    expect(result).toMatchObject({ accessToken: 'access', refreshToken: 'refresh', expiresAt: update.data.expiresAt });
  });

  it('only views customers', async () => {
    const { service, sessions } = setup({ owner: null });
    await expect(service.start('admin-2', 'admin-1', {})).rejects.toThrow(NotFoundException);
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('refuses a suspended account', async () => {
    const { service, sessions } = setup({ owner: { id: 'user-1', status: 'SUSPENDED' } });
    await expect(service.start('user-1', 'admin-1', {})).rejects.toThrow(BadRequestException);
    expect(sessions.create).not.toHaveBeenCalled();
  });
});

describe('OwnerImpersonationService.end', () => {
  it("signs out this admin's views of the customer and logs it", async () => {
    const { service, prisma, sessions } = setup({ views: [{ id: 's1' }, { id: 's2' }] });
    await expect(service.end('user-1', 'admin-1')).resolves.toEqual({ ended: 2 });
    expect(prisma.authSession.findMany).toHaveBeenCalledWith({ where: { userId: 'user-1', impersonatedBy: 'admin-1' }, select: { id: true } });
    expect(sessions.revoke.mock.calls).toEqual([['s1'], ['s2']]);
    expect(prisma.auditLog.create.mock.calls[0][0]).toMatchObject({ data: { action: 'USER_IMPERSONATION_ENDED' } });
  });

  it('logs nothing when there was nothing to end', async () => {
    const { service, prisma } = setup();
    await expect(service.end('user-1', 'admin-1')).resolves.toEqual({ ended: 0 });
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});
