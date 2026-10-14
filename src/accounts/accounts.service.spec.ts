import { BadRequestException } from '@nestjs/common';
import { AccountsService } from './accounts.service.js';

const receivable = { id: 'ar', businessId: 'biz-1', accountType: 'ASSET', accountSubtype: 'receivable', isSystemAccount: true, status: 'ACTIVE', parentId: null };

const setup = (rows: Record<string, { id: string; businessId: string; accountType: string; accountSubtype: string | null; isSystemAccount: boolean; status: string; parentId: string | null }>) => {
  const prisma = {
    account: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) => Promise.resolve(rows[where.id] ?? null)),
      create: vi.fn().mockResolvedValue({ id: 'new' }),
      update: vi.fn().mockResolvedValue({ id: 'updated' }),
      count: vi.fn().mockResolvedValue(0),
      delete: vi.fn().mockResolvedValue({}),
    },
    transactionEntry: { count: vi.fn().mockResolvedValue(0) },
  };
  return { service: new AccountsService(prisma as never), prisma };
};

describe('AccountsService reserved system accounts', () => {
  it('refuses a new account with a reserved subtype', async () => {
    const { service, prisma } = setup({});
    await expect(service.create('biz-1', { name: 'Staff advance', accountType: 'ASSET', accountSubtype: 'receivable' })).rejects.toThrow(BadRequestException);
    expect(prisma.account.create).not.toHaveBeenCalled();
  });

  it("refuses to change the system receivable's subtype", async () => {
    const { service, prisma } = setup({ ar: receivable });
    await expect(service.update('biz-1', 'ar', { accountSubtype: 'loan' })).rejects.toThrow(BadRequestException);
    expect(prisma.account.update).not.toHaveBeenCalled();
  });

  it('still lets the system receivable be renamed', async () => {
    const { service, prisma } = setup({ ar: receivable });
    await service.update('biz-1', 'ar', { name: 'Customers owe me', accountSubtype: 'receivable' });
    expect(prisma.account.update).toHaveBeenCalled();
  });

  it('refuses to archive or remove the system receivable', async () => {
    const { service, prisma } = setup({ ar: receivable });
    await expect(service.archive('biz-1', 'ar')).rejects.toThrow(BadRequestException);
    await expect(service.removeOrArchive('biz-1', 'ar')).rejects.toThrow(BadRequestException);
    expect(prisma.account.delete).not.toHaveBeenCalled();
  });
});

describe('AccountsService.update parent', () => {
  const base = { businessId: 'biz-1', accountType: 'EXPENSE', accountSubtype: null, isSystemAccount: false, status: 'ACTIVE' };

  it('refuses to move an account under its own descendant', async () => {
    const { service, prisma } = setup({
      a: { id: 'a', ...base, parentId: null },
      b: { id: 'b', ...base, parentId: 'a' },
      c: { id: 'c', ...base, parentId: 'b' },
    });
    await expect(service.update('biz-1', 'a', { parentId: 'c' })).rejects.toThrow(BadRequestException);
    expect(prisma.account.update).not.toHaveBeenCalled();
  });

  it('allows moving under an unrelated account', async () => {
    const { service, prisma } = setup({
      a: { id: 'a', ...base, parentId: null },
      x: { id: 'x', ...base, parentId: null },
    });
    await service.update('biz-1', 'a', { parentId: 'x' });
    expect(prisma.account.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: { parentId: 'x' } });
  });
});
