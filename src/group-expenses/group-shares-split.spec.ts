import { GroupExpensesService, percentsFromShares } from './group-expenses.service.js';

const setup = (settings: { costSplit: 'EQUAL' | 'CUSTOM'; splitFromShares: boolean } | null, shares: number[]) => {
  const prisma = {
    groupSettings: { findUnique: vi.fn().mockResolvedValue(settings), update: vi.fn(), upsert: vi.fn() },
    groupMember: {
      findMany: vi.fn().mockResolvedValue(shares.map((units, index) => ({ id: `m${index}`, shareUnits: String(units) }))),
      update: vi.fn().mockImplementation((args: unknown) => args),
    },
    groupCostWeight: { count: vi.fn().mockResolvedValue(0), upsert: vi.fn() },
    $transaction: vi.fn(),
  };
  return { service: new GroupExpensesService(prisma as never, { sync: vi.fn(), accessOf: vi.fn() } as never), prisma };
};

describe('shares and the cost split', () => {
  it('works shares out as percents adding up to 100', () => {
    expect(percentsFromShares([3, 1, 4])).toEqual([37.5, 12.5, 50]);
    expect(percentsFromShares([1, 1, 1]).reduce((sum, value) => sum + value, 0)).toBeCloseTo(100, 5);
  });

  it('turns an equal split into one by shares when shares differ', async () => {
    const { service, prisma } = setup({ costSplit: 'EQUAL', splitFromShares: false }, [3, 1, 4]);
    await service.followShares('biz-1');
    expect(prisma.groupMember.update).toHaveBeenCalledWith({ where: { id: 'm0' }, data: { costPercent: 37.5 } });
    expect(prisma.groupSettings.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { costSplit: 'CUSTOM', splitFromShares: true } }));
  });

  it('goes back to equal when a split from shares meets equal shares', async () => {
    const { service, prisma } = setup({ costSplit: 'CUSTOM', splitFromShares: true }, [2, 2]);
    await service.followShares('biz-1');
    expect(prisma.groupSettings.update).toHaveBeenCalledWith({ where: { businessId: 'biz-1' }, data: { costSplit: 'EQUAL', splitFromShares: false } });
  });

  it('never touches a custom split the owner set by hand', async () => {
    const { service, prisma } = setup({ costSplit: 'CUSTOM', splitFromShares: false }, [3, 1, 4]);
    await service.followShares('biz-1');
    // Its weights read before and after are the same: nothing is written.
    expect(prisma.groupMember.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
