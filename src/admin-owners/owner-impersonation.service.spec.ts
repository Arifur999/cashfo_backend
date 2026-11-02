import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { OwnerImpersonationService } from './owner-impersonation.service.js';
import { SupportAccessService } from '../support-access/support-access.service.js';

const setup = ({
  owner = { id: 'user-1', status: 'ACTIVE' } as { id: string; status: string } | null,
  views = [] as { id: string }[],
  consent = 'ok' as 'ok' | 'none' | 'wrong',
} = {}) => {
  const prisma = {
    user: { findUnique: vi.fn().mockResolvedValue(owner) },
    authSession: { update: vi.fn((args) => args), findMany: vi.fn().mockResolvedValue(views) },
    auditLog: { create: vi.fn((args) => args) },
    $transaction: vi.fn().mockResolvedValue([]),
  };
  const sessions = { create: vi.fn().mockResolvedValue('session-9'), revoke: vi.fn() };
  const tokens = { issue: vi.fn().mockReturnValue({ accessToken: 'access', refreshToken: 'refresh' }) };
  // The real consent check, over a stubbed code lookup.
  const supportAccess = Object.assign(new SupportAccessService(prisma as never, {} as never), { consume: vi.fn().mockResolvedValue(consent) });
  const service = new OwnerImpersonationService(prisma as never, sessions as never, tokens as never, supportAccess as never);
  return { service, prisma, sessions, tokens, supportAccess };
};

describe('OwnerImpersonationService.start', () => {
  it('opens a customer session marked with the admin, for an hour, and logs it', async () => {
    const { service, prisma, sessions, tokens } = setup();
    const before = Date.now();
    const result = await service.start('user-1', 'admin-1', { ipAddress: '203.0.113.5', userAgent: 'Chrome' }, '123456');

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
    await expect(service.start('admin-2', 'admin-1', {}, '123456')).rejects.toThrow(NotFoundException);
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('refuses a suspended account', async () => {
    const { service, sessions } = setup({ owner: { id: 'user-1', status: 'SUSPENDED' } });
    await expect(service.start('user-1', 'admin-1', {}, '123456')).rejects.toThrow(BadRequestException);
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it("opens only with the customer's support code", async () => {
    const { service, supportAccess } = setup();
    await service.start('user-1', 'admin-1', {}, '123456');
    expect(supportAccess.consume).toHaveBeenCalledWith('user-1', '123456');
  });

  it.each([
    ['none', 'no-code'],
    ['wrong', 'wrong-code'],
  ] as const)('refuses and logs a %s code without opening a session', async (consent, reason) => {
    const { service, prisma, sessions } = setup({ consent });
    await expect(service.start('user-1', 'admin-1', { ipAddress: '203.0.113.5' }, '000000')).rejects.toThrow(ForbiddenException);
    expect(sessions.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create.mock.calls[0][0]).toMatchObject({
      data: { adminUserId: 'admin-1', action: 'USER_IMPERSONATION_REFUSED', entityId: 'user-1', newValue: { reason }, ipAddress: '203.0.113.5' },
    });
  });

  it('never spends a code on a suspended account', async () => {
    const { service, supportAccess } = setup({ owner: { id: 'user-1', status: 'SUSPENDED' } });
    await expect(service.start('user-1', 'admin-1', {}, '123456')).rejects.toThrow(BadRequestException);
    expect(supportAccess.consume).not.toHaveBeenCalled();
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
