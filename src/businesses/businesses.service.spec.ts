import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { BusinessesService } from './businesses.service.js';

const owner = { businessId: 'biz-1', userId: 'user-1', role: 'OWNER' as const };

const setup = ({ isDefault = false, transactions = 0 } = {}) => {
  const prisma = {
    business: {
      findUnique: vi.fn().mockResolvedValue({ id: 'biz-1', isDefault, deletedAt: null }),
      update: vi.fn().mockResolvedValue({}),
    },
    transaction: { count: vi.fn().mockResolvedValue(transactions) },
  };
  const service = new BusinessesService(prisma as never, {} as never);
  return { service, prisma };
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
