import { Prisma } from '@prisma/client';
import { BudgetsService, nextCategoryColor } from './budgets.service.js';

const money = (value: number | null) => ({ _sum: { amount: value === null ? null : new Prisma.Decimal(value) } });

const setup = () => {
  const prisma = {
    incomeGoal: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
    transactionEntry: { aggregate: vi.fn(), groupBy: vi.fn() },
    budgetCategory: { findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn(), create: vi.fn((args: unknown) => Promise.resolve(args)) },
  };
  // INCOME is asked first, then EXPENSE.
  prisma.transactionEntry.aggregate.mockImplementation(({ where }: { where: { transaction: { transactionType: string } } }) =>
    Promise.resolve(money(where.transaction.transactionType === 'INCOME' ? 120500 : 63000)),
  );
  return { service: new BudgetsService(prisma as never), prisma };
};

describe('monthly plans', () => {
  it('reads a month with no plan as null figures and its real totals', async () => {
    const { service, prisma } = setup();
    prisma.incomeGoal.findUnique.mockResolvedValue(null);
    await expect(service.getMonthlyPlan('biz-1', 2026, 10)).resolves.toEqual({
      id: null,
      month: 10,
      year: 2026,
      incomeTarget: null,
      expenseBudget: null,
      earned: '120500.00',
      spent: '63000.00',
    });
    const { where } = prisma.transactionEntry.aggregate.mock.calls[0][0] as { where: { transaction: { transactionDate: { gte: Date; lt: Date } } } };
    expect(where.transaction.transactionDate).toEqual({ gte: new Date('2026-10-01T00:00:00Z'), lt: new Date('2026-11-01T00:00:00Z') });
  });

  it('saves a month as one plan, made or replaced', async () => {
    const { service, prisma } = setup();
    prisma.incomeGoal.findUnique.mockResolvedValue({
      id: 'g1',
      month: 11,
      year: 2026,
      amount: new Prisma.Decimal(135000),
      expenseBudget: new Prisma.Decimal(72000),
    });
    const saved = await service.saveMonthlyPlan('biz-1', { month: 11, year: 2026, incomeTarget: 135000, expenseBudget: 72000 });
    expect(prisma.incomeGoal.upsert).toHaveBeenCalledWith({
      where: { businessId_year_month: { businessId: 'biz-1', year: 2026, month: 11 } },
      create: { businessId: 'biz-1', year: 2026, month: 11, amount: 135000, expenseBudget: 72000 },
      update: { amount: 135000, expenseBudget: 72000 },
    });
    expect(saved).toMatchObject({ id: 'g1', incomeTarget: '135000.00', expenseBudget: '72000.00', earned: '120500.00', spent: '63000.00' });
  });

  it('lists every plan newest first, an old plan without a budget reading null', async () => {
    const { service, prisma } = setup();
    prisma.incomeGoal.findMany.mockResolvedValue([{ id: 'g0', month: 9, year: 2026, amount: new Prisma.Decimal(125000), expenseBudget: null }]);
    await expect(service.listMonthlyPlans('biz-1')).resolves.toEqual([
      { id: 'g0', month: 9, year: 2026, incomeTarget: '125000.00', expenseBudget: null, earned: '120500.00', spent: '63000.00' },
    ]);
    expect(prisma.incomeGoal.findMany).toHaveBeenCalledWith({ where: { businessId: 'biz-1' }, orderBy: [{ year: 'desc' }, { month: 'desc' }] });
  });
});

describe('Category Set', () => {
  it('counts the live transactions that name each category, by type', async () => {
    const { service, prisma } = setup();
    prisma.budgetCategory.findMany.mockResolvedValue([
      { id: 'c1', type: 'INCOME', name: 'Salary', icon: null, color: 'teal', monthlyLimit: null },
      { id: 'c2', type: 'EXPENSE', name: 'Food', icon: 'food', color: 'orange', monthlyLimit: new Prisma.Decimal(5000) },
      { id: 'c3', type: 'EXPENSE', name: 'Gift', icon: null, color: 'pink', monthlyLimit: null },
    ]);
    prisma.transactionEntry.groupBy.mockImplementation(({ where }: { where: { transaction: { transactionType: string } } }) =>
      Promise.resolve(
        where.transaction.transactionType === 'INCOME' ? [{ categoryId: 'Salary', _count: { _all: 12 } }, { categoryId: 'Gift', _count: { _all: 3 } }] : [{ categoryId: 'Food', _count: { _all: 48 } }],
      ),
    );
    const set = await service.listCategorySet('biz-1');
    expect(set.income).toEqual([{ id: 'c1', type: 'INCOME', name: 'Salary', icon: null, color: 'teal', monthlyLimit: null, transactionCount: 12 }]);
    // An expense "Gift" is not counted by an income "Gift".
    expect(set.expense.map((row) => [row.name, row.transactionCount, row.monthlyLimit])).toEqual([
      ['Food', 48, '5000.00'],
      ['Gift', 0, null],
    ]);
  });

  it('makes an expense category from just a name, picking a colour not yet used', async () => {
    const { service, prisma } = setup();
    prisma.budgetCategory.findMany.mockResolvedValue([{ color: 'blue' }, { color: 'green' }]);
    await service.createCategory('biz-1', { type: 'EXPENSE', name: 'Mobile & Internet' });
    expect(prisma.budgetCategory.create).toHaveBeenCalledWith({
      data: { businessId: 'biz-1', type: 'EXPENSE', name: 'Mobile & Internet', icon: undefined, color: 'purple', monthlyLimit: null, displayOrder: 2 },
    });
  });

  it('cycles the colours once every one is used', () => {
    expect(nextCategoryColor([])).toBe('blue');
    const all = ['blue', 'green', 'purple', 'orange', 'pink', 'yellow', 'red', 'indigo', 'teal', 'cyan', 'violet', 'lime'];
    expect(nextCategoryColor(all)).toBe('blue');
    expect(nextCategoryColor([...all, 'blue'])).toBe('green');
  });
});
