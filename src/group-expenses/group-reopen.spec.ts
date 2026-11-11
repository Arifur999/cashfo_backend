import { ConflictException } from '@nestjs/common';
import { GroupExpensesService } from './group-expenses.service.js';

const settlement = { id: 'set-sep', businessId: 'biz-1', periodStart: new Date('2026-09-01'), periodEnd: new Date('2026-09-30'), carriedForward: true };

const setup = (later: object | null) => {
  const tx = {
    $executeRaw: vi.fn(),
    groupSettlement: {
      findFirst: vi.fn().mockImplementation(({ where }: { where: { id?: string } }) => Promise.resolve(where.id ? settlement : later)),
      delete: vi.fn(),
    },
    groupSettlementMember: { deleteMany: vi.fn() },
    groupContribution: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
  };
  const prisma = { $transaction: vi.fn().mockImplementation((fn: (client: typeof tx) => unknown) => fn(tx)), groupActivity: { create: vi.fn() } };
  return { service: new GroupExpensesService(prisma as never, { sync: vi.fn(), accessOf: vi.fn() } as never), tx, prisma };
};

describe('GroupExpensesService.reopenSettlement', () => {
  it('reopens the newest closed month and takes back the balances it carried', async () => {
    const { service, tx, prisma } = setup(null);
    await expect(service.reopenSettlement('biz-1', 'set-sep', 'owner-1')).resolves.toEqual({ id: 'set-sep', reopened: true });
    expect(tx.groupContribution.deleteMany).toHaveBeenCalledWith({
      where: { businessId: 'biz-1', kind: 'CARRY', date: new Date('2026-10-01'), note: 'Carried from 2026-09-01 to 2026-09-30' },
    });
    expect(tx.groupSettlementMember.deleteMany).toHaveBeenCalledWith({ where: { settlementId: 'set-sep' } });
    expect(tx.groupSettlement.delete).toHaveBeenCalledWith({ where: { id: 'set-sep' } });
    expect(prisma.groupActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ summary: expect.objectContaining({ reopened: true, carriedRemoved: 2 }) }) }),
    );
  });

  it('refuses while a later month that started from it is closed', async () => {
    const { service, tx } = setup({ periodStart: new Date('2026-10-01') });
    await expect(service.reopenSettlement('biz-1', 'set-sep', 'owner-1')).rejects.toThrow(ConflictException);
    expect(tx.groupSettlement.delete).not.toHaveBeenCalled();
  });
});
