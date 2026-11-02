import { createHash } from 'node:crypto';
import { SUPPORT_CODE_TRIES, SupportAccessService, supportCodeIdentifier } from './support-access.service.js';

const hashOf = (code: string) => createHash('sha256').update(code).digest('hex');
const inMinutes = (n: number) => new Date(Date.now() + n * 60 * 1000);

const setup = ({ row = null as null | { id: string; value: string; expiresAt: Date }, deleted = 1, views = [] as { id: string; impersonatedBy: string | null }[] } = {}) => {
  const prisma = {
    verification: {
      deleteMany: vi.fn().mockResolvedValue({ count: deleted }),
      create: vi.fn((args) => args),
      findFirst: vi.fn().mockResolvedValue(row),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    auditLog: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
    authSession: { findMany: vi.fn().mockResolvedValue(views), count: vi.fn().mockResolvedValue(0) },
    // The array form (issuing a code) or the locked check (consume).
    $transaction: vi.fn((work: unknown) => (typeof work === 'function' ? work(prisma) : Promise.resolve([]))),
    $executeRaw: vi.fn(),
  };
  const sessions = { revoke: vi.fn() };
  return { service: new SupportAccessService(prisma as never, sessions as never), prisma, sessions };
};

describe('SupportAccessService.create', () => {
  it('makes a 6-digit code for 15 minutes, keeps only its hash, and replaces any earlier one', async () => {
    const { service, prisma } = setup();
    const before = Date.now();
    const { code, expiresAt } = await service.create('user-1');

    expect(code).toMatch(/^\d{6}$/);
    expect(expiresAt.getTime() - before).toBeGreaterThanOrEqual(15 * 60 * 1000 - 1000);
    expect(prisma.verification.deleteMany).toHaveBeenCalledWith({ where: { identifier: supportCodeIdentifier('user-1') } });
    const stored = prisma.verification.create.mock.calls[0][0].data;
    expect(stored.identifier).toBe('support-access:user-1');
    expect(stored.value).not.toContain(code);
    expect(JSON.parse(stored.value)).toEqual({ hash: hashOf(code), tries: 0 });
  });
});

describe('SupportAccessService.consume', () => {
  const live = (code = '123456', tries = 0) => ({ id: 'v1', value: JSON.stringify({ hash: hashOf(code), tries }), expiresAt: inMinutes(10) });

  it('lets the right code in once, and uses it up', async () => {
    const { service, prisma } = setup({ row: live() });
    await expect(service.consume('user-1', '123456')).resolves.toBe('ok');
    expect(prisma.verification.deleteMany).toHaveBeenCalledWith({ where: { id: 'v1' } });
  });

  it('lets only one of two racing requests in', async () => {
    const { service } = setup({ row: live(), deleted: 0 });
    await expect(service.consume('user-1', '123456')).resolves.toBe('none');
  });

  it('has nothing to use when there is no code or it expired', async () => {
    await expect(setup().service.consume('user-1', '123456')).resolves.toBe('none');
    const expired = { ...live(), expiresAt: inMinutes(-1) };
    await expect(setup({ row: expired }).service.consume('user-1', '123456')).resolves.toBe('none');
  });

  it('counts a wrong code', async () => {
    const { service, prisma } = setup({ row: live() });
    await expect(service.consume('user-1', '654321')).resolves.toBe('wrong');
    expect(prisma.verification.updateMany).toHaveBeenCalledWith({ where: { id: 'v1' }, data: { value: JSON.stringify({ hash: hashOf('123456'), tries: 1 }) } });
    expect(prisma.verification.deleteMany).not.toHaveBeenCalled();
  });

  it('throws the code away on the last wrong try', async () => {
    const { service, prisma } = setup({ row: live('123456', SUPPORT_CODE_TRIES - 1) });
    await expect(service.consume('user-1', '654321')).resolves.toBe('wrong');
    expect(prisma.verification.deleteMany).toHaveBeenCalledWith({ where: { id: 'v1' } });
  });
});

describe('SupportAccessService.revoke', () => {
  it('takes the code back and ends every open support view, logging each admin once', async () => {
    const { service, prisma, sessions } = setup({ views: [{ id: 's1', impersonatedBy: 'admin-1' }, { id: 's2', impersonatedBy: 'admin-1' }] });
    await expect(service.revoke('user-1', '203.0.113.5')).resolves.toEqual({ ended: 2 });
    expect(prisma.verification.deleteMany).toHaveBeenCalledWith({ where: { identifier: 'support-access:user-1' } });
    expect(sessions.revoke.mock.calls).toEqual([['s1'], ['s2']]);
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create.mock.calls[0][0]).toMatchObject({ data: { adminUserId: 'admin-1', action: 'USER_IMPERSONATION_ENDED', newValue: { endedBy: 'customer' } } });
  });
});
