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
    .mockResolvedValueOnce([{ amount: D(1_500) }])
    // This month's income and expenses (the net worth's move).
    .mockResolvedValueOnce([
      { type: 'INCOME', count: 1, amount: D(85_000) },
      { type: 'EXPENSE', count: 4, amount: D(35_250) },
    ]);
  const prisma = {
    $queryRaw: queryRaw,
    savingsGoalEntry: { groupBy: vi.fn().mockResolvedValue([{ type: 'CONTRIBUTION', _sum: { amount: D(20_000) } }, { type: 'WITHDRAWAL', _sum: { amount: D(5_000) } }]) },
    asset: {
      aggregate: vi.fn().mockResolvedValueOnce({ _sum: { purchasePrice: D(30_000) } }).mockResolvedValueOnce({ _sum: { soldPrice: null } }),
      findMany: vi.fn().mockResolvedValue([
        // Valued at 1,10,000 before this month, 1,20,000 now.
        { purchaseDate: new Date('2025-01-01T00:00:00Z'), purchasePrice: D(100_000), currentValue: D(120_000), valueHistory: [{ value: D(110_000) }] },
        // Bought this month for 30,000, now 28,000.
        { purchaseDate: new Date('2026-11-03T00:00:00Z'), purchasePrice: D(30_000), currentValue: D(28_000), valueHistory: [] },
      ]),
    },
  };
  const loans = { loanFlow: vi.fn().mockResolvedValue({ GAVE: 10_000, TOOK: 0, GOT_BACK: 2_000, PAID_BACK: 0 }) };
  return { service: new MoneyFlowService(prisma as never, loans as never), prisma, loans };
};

describe('MoneyFlowService', () => {
  it('splits gifts from expenses and moves the net worth by income less expenses and asset value changes', async () => {
    const { service, loans } = setup();
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
      worthChange: 85_000 - 35_250 + 10_000 - 2_000,
    });
    expect(loans.loanFlow).toHaveBeenCalledWith('b1', '2026-10-01', '2026-10-31');
  });

  it('refuses a backwards or too long period', async () => {
    const { service } = setup();
    await expect(service.flow('b1', '2026-10-31', '2026-10-01')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.flow('b1', '2020-01-01', '2026-10-01')).rejects.toBeInstanceOf(BadRequestException);
  });
});
