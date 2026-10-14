import { BadRequestException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { BusinessesService } from './businesses.service.js';

const owner = { businessId: 'biz-1', userId: 'user-1', role: 'OWNER' as const };

const user = { id: 'user-1', email: 'owner@example.com', sessionId: 'session-1' };

const setup = ({ isDefault = false, transactions = 0, pinHash = null as string | null, password = 'right', hasPassword = true } = {}) => {
  const prisma = {
    business: {
      findUnique: vi.fn().mockResolvedValue({ id: 'biz-1', isDefault, deletedAt: null, pinHash }),
      update: vi.fn().mockResolvedValue({}),
    },
    transaction: { count: vi.fn().mockResolvedValue(transactions) },
  };
  const credentials = { verify: vi.fn(async (_id: string, given: string) => given === password), has: vi.fn().mockResolvedValue(hasPassword) };
  const unlocks = { issue: vi.fn().mockReturnValue({ unlockToken: 'unlock-token', expiresIn: 60 }) };
  const service = new BusinessesService(prisma as never, {} as never, credentials as never, unlocks as never);
  return { service, prisma, unlocks };
};

describe('BusinessesService.remove', () => {
  it('soft-deletes a workspace with no transactions', async () => {
    const { service, prisma } = setup();
    await expect(service.remove('biz-1', owner)).resolves.toEqual({ success: true });
    expect(prisma.transaction.count).toHaveBeenCalledWith({ where: { businessId: 'biz-1' } });
    expect(prisma.business.update).toHaveBeenCalledWith({ where: { id: 'biz-1' }, data: { deletedAt: expect.any(Date) } });
  });

  it('keeps a workspace that has transactions', async () => {
    const { service, prisma } = setup({ transactions: 3 });
    await expect(service.remove('biz-1', owner)).rejects.toThrow(BadRequestException);
    expect(prisma.business.update).not.toHaveBeenCalled();
  });

  it('never deletes the default workspace', async () => {
    const { service, prisma } = setup({ isDefault: true });
    await expect(service.remove('biz-1', owner)).rejects.toThrow(BadRequestException);
    expect(prisma.transaction.count).not.toHaveBeenCalled();
  });

  it('is for the owner only', async () => {
    const { service } = setup();
    await expect(service.remove('biz-1', { ...owner, role: 'STAFF' })).rejects.toThrow(ForbiddenException);
  });
});

describe('BusinessesService.verifyPin', () => {
  it('hands a correct PIN the unlock for this session', async () => {
    const pinHash = await bcrypt.hash('1234', 4);
    const { service, unlocks } = setup({ pinHash });
    await expect(service.verifyPin('biz-1', user, '1234')).resolves.toEqual({ valid: true, unlock: { unlockToken: 'unlock-token', expiresIn: 60 } });
    expect(unlocks.issue).toHaveBeenCalledWith('user-1', 'session-1', 'biz-1', pinHash);
  });

  it('gives a wrong PIN nothing', async () => {
    const { service, unlocks } = setup({ pinHash: await bcrypt.hash('1234', 4) });
    await expect(service.verifyPin('biz-1', user, '9999')).resolves.toEqual({ valid: false });
    expect(unlocks.issue).not.toHaveBeenCalled();
  });
});

describe('BusinessesService.resetPin', () => {
  it('removes the lock for the owner with the account password', async () => {
    const { service, prisma } = setup({ pinHash: 'hash' });
    await expect(service.resetPin('biz-1', owner, 'right')).resolves.toEqual({ success: true });
    expect(prisma.business.update).toHaveBeenCalledWith({ where: { id: 'biz-1' }, data: { pinHash: null } });
  });

  it('refuses a wrong password', async () => {
    const { service, prisma } = setup({ pinHash: 'hash' });
    await expect(service.resetPin('biz-1', owner, 'wrong')).rejects.toThrow('Your account password is incorrect');
    expect(prisma.business.update).not.toHaveBeenCalled();
  });

  it('tells a Google-only account to set a password first', async () => {
    const { service } = setup({ pinHash: 'hash', hasPassword: false });
    await expect(service.resetPin('biz-1', owner, 'anything')).rejects.toThrow('sign in with Google');
  });

  it('is for the owner only', async () => {
    const { service, prisma } = setup({ pinHash: 'hash' });
    await expect(service.resetPin('biz-1', { ...owner, role: 'STAFF' }, 'right')).rejects.toThrow(ForbiddenException);
    expect(prisma.business.update).not.toHaveBeenCalled();
  });
});
