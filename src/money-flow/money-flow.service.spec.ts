import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MoneyFlowService } from './money-flow.service.js';

const D = (value: number) => new Prisma.Decimal(value);

const setup = () => {
  const queryRaw = vi
    .fn()
    // The period's income and expenses.
    .mockResolvedValueOnce([
      { type: 'INCOME', count: 3, amount: D(85_000) },
      { type: 'EXPENSE', count: 9, amount: D(52_300) },
    ])
    // Cash gifts given at events.
    .mockResolvedValueOnce([{ amount: D(1_500) }]);
  const prisma = {
    $queryRaw: queryRaw,
    savingsGoalEntry: { groupBy: vi.fn().mockResolvedValue([{ type: 'CONTRIBUTION', _sum: { amount: D(20_000) } }, { type: 'WITHDRAWAL', _sum: { amount: D(5_000) } }]) },
    asset: {
      aggregate: vi.fn().mockResolvedValueOnce({ _sum: { purchasePrice: D(30_000) } }).mockResolvedValueOnce({ _sum: { soldPrice: null } }),
    },
  };
  const loans = { loanFlow: vi.fn().mockResolvedValue({ GAVE: 10_000, TOOK: 0, GOT_BACK: 2_000, PAID_BACK: 0 }) };
  // The net worth when last month ended, and today.
  const worthOn = (day: string, cash: number) => ({ day, parts: { cash, savings: 20_000, assets: 0, pawna: 5_000, dena: 10_000 }, counts: { accounts: 1, assets: 0, pawna: 1, dena: 1 } });
  const netWorth = { on: vi.fn().mockResolvedValue([worthOn('2026-10-31', 100_000), worthOn('2026-11-07', 155_750)]) };
  return { service: new MoneyFlowService(prisma as never, loans as never, netWorth as never), prisma, loans, netWorth };
};

describe('MoneyFlowService', () => {
  it('splits gifts from expenses, and moves the net worth by what the records held on both days', async () => {
    const { service, loans, netWorth } = setup();
    const flow = await service.flow('b1', '2026-10-01', '2026-10-31', new Date('2026-11-07T06:00:00Z'));
    expect(flow).toEqual({
      dateFrom: '2026-10-01',
      dateTo: '2026-10-31',
      income: { amount: 85_000, count: 3 },
      expenses: { amount: 50_800, count: 9 },
      savings: { added: 20_000, takenOut: 5_000 },
      loans: { took: 0, gotBack: 2_000, gave: 10_000, paidBack: 0 },
      assets: { bought: 30_000, sold: 0 },
      gifts: { gave: 1_500, got: 0 },
      worthChange: 55_750,
    });
    expect(netWorth.on).toHaveBeenCalledWith('b1', ['2026-10-31', '2026-11-07'], '2026-11-07');
    expect(loans.loanFlow).toHaveBeenCalledWith('b1', '2026-10-01', '2026-10-31');
  });

  it('refuses a backwards or too long period', async () => {
    const { service } = setup();
    await expect(service.flow('b1', '2026-10-31', '2026-10-01')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.flow('b1', '2020-01-01', '2026-10-01')).rejects.toBeInstanceOf(BadRequestException);
  });
});
