import { Prisma } from '@prisma/client';
import { BUDGET_CATEGORY_COLORS, BUDGET_CATEGORY_ICONS } from './budget-category-visuals.js';
import { isReservedCategoryName, seedStarterCategories, STARTER_CATEGORIES } from './app-categories.js';
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
        where.transaction.transactionType === 'INCOME'
          ? [
              { categoryId: 'Salary', _count: { _all: 12 } },
              { categoryId: 'Gift', _count: { _all: 3 } },
            ]
          : [{ categoryId: 'Food', _count: { _all: 48 } }],
      ),
    );
    const set = await service.listCategorySet('biz-1');
    expect(set.income).toEqual([
      { id: 'c1', type: 'INCOME', name: 'Salary', icon: null, color: 'teal', monthlyLimit: null, transactionCount: 12, system: null },
    ]);
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

  it('marks Zakat as kept by the Zakat page, and lists the built-in charge categories in use as automatic', async () => {
    const { service, prisma } = setup();
    prisma.budgetCategory.findMany.mockResolvedValue([{ id: 'z', type: 'EXPENSE', name: 'Zakat', icon: 'heart', color: 'green', monthlyLimit: null }]);
    prisma.transactionEntry.groupBy.mockImplementation(({ where }: { where: { transaction: { transactionType: string } } }) =>
      Promise.resolve(
        where.transaction.transactionType === 'EXPENSE'
          ? [
              { categoryId: 'Zakat', _count: { _all: 2 } },
              { categoryId: 'Bank charge', _count: { _all: 3 } },
            ]
          : [],
      ),
    );
    const set = await service.listCategorySet('biz-1');
    expect(set.expense[0]).toMatchObject({ name: 'Zakat', system: 'zakat', transactionCount: 2 });
    expect(set.automatic).toEqual([{ type: 'EXPENSE', name: 'Bank charge', kind: 'charges', transactionCount: 3 }]);
  });

  it('keeps the names the app files money under for the app', async () => {
    const { service } = setup();
    expect(isReservedCategoryName(' zakat ')).toBe(true);
    expect(isReservedCategoryName('Mobile banking fee')).toBe(true);
    expect(isReservedCategoryName('Uncategorised')).toBe(true);
    expect(isReservedCategoryName('Zakat fund')).toBe(false);
    await expect(service.createCategory('biz-1', { type: 'EXPENSE', name: 'Bank charge' })).rejects.toThrow('used by the app');
  });

  it('cycles the colours once every one is used', () => {
    expect(nextCategoryColor([])).toBe('blue');
    const all = ['blue', 'green', 'purple', 'orange', 'pink', 'yellow', 'red', 'indigo', 'teal', 'cyan', 'violet', 'lime'];
    expect(nextCategoryColor(all)).toBe('blue');
    expect(nextCategoryColor([...all, 'blue'])).toBe('green');
  });
});

describe('starter categories', () => {
  it('uses colours and icons the app knows', () => {
    for (const starter of Object.values(STARTER_CATEGORIES).flat()) {
      expect(BUDGET_CATEGORY_COLORS).toContain(starter!.color);
      expect(BUDGET_CATEGORY_ICONS).toContain(starter!.icon);
    }
  });

  it('adds only the ones missing, after the workspace own ones, and none to a group', async () => {
    const client = {
      budgetCategory: {
        findMany: vi.fn().mockResolvedValue([
          { type: 'INCOME', name: 'salary' },
          { type: 'EXPENSE', name: 'Rent' },
        ]),
        createMany: vi.fn((args: { data: unknown[]; skipDuplicates?: boolean }) => Promise.resolve({ count: args.data.length })),
      },
    };
    await expect(seedStarterCategories(client as never, 'biz-1', 'PERSONAL')).resolves.toBe(10);
    const data = client.budgetCategory.createMany.mock.calls[0][0].data as { type: string; name: string; displayOrder: number }[];
    expect(data.some((row) => row.name === 'Salary')).toBe(false);
    expect(data.find((row) => row.name === 'Freelance')).toMatchObject({ type: 'INCOME', displayOrder: 1 });
    expect(data.find((row) => row.name === 'Food & Dining')).toMatchObject({ type: 'EXPENSE', displayOrder: 1 });
    expect(client.budgetCategory.createMany.mock.calls[0][0].skipDuplicates).toBe(true);
    await expect(seedStarterCategories(client as never, 'biz-1', 'GROUP')).resolves.toBe(0);
  });
});

describe('changing and deleting a category', () => {
  const category = (more: Partial<{ id: string; type: 'INCOME' | 'EXPENSE'; name: string; businessId: string }> = {}) => ({
    id: 'c1',
    businessId: 'biz-1',
    type: 'EXPENSE',
    name: 'Food',
    ...more,
  });
  const setupDelete = ({ uses = 0, others = 1, target = category({ id: 'c2', name: 'Groceries' }) as ReturnType<typeof category> | null } = {}) => {
    const tx = {
      transactionEntry: { updateMany: vi.fn().mockResolvedValue({ count: uses }) },
      budgetCategory: { delete: vi.fn(), update: vi.fn() },
    };
    const prisma = {
      budgetCategory: {
        findUnique: vi.fn(({ where }: { where: { id?: string } }) => Promise.resolve(where.id === 'c1' ? category() : where.id === 'c2' ? target : null)),
        count: vi.fn().mockResolvedValue(others),
        delete: vi.fn(),
        update: vi.fn(),
      },
      transactionEntry: { count: vi.fn().mockResolvedValue(uses) },
      $transaction: vi.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    return { service: new BudgetsService(prisma as never), prisma, tx };
  };

  it('deletes an unused category at once', async () => {
    const { service, prisma } = setupDelete();
    await expect(service.deleteCategory('biz-1', 'c1')).resolves.toEqual({ id: 'c1', moved: 0 });
    expect(prisma.budgetCategory.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
  });

  it('moves the transactions of a category in use to another of its type first', async () => {
    const { service, prisma, tx } = setupDelete({ uses: 4 });
    await expect(service.deleteCategory('biz-1', 'c1')).rejects.toThrow('Pick the expense category they move to');
    await expect(service.deleteCategory('biz-1', 'c1', 'c2')).resolves.toEqual({ id: 'c1', moved: 4 });
    expect(tx.transactionEntry.updateMany).toHaveBeenCalledWith({
      where: { categoryId: 'Food', transaction: { businessId: 'biz-1', transactionType: 'EXPENSE' } },
      data: { categoryId: 'Groceries' },
    });
    expect(tx.budgetCategory.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
    expect(prisma.budgetCategory.delete).not.toHaveBeenCalled();
  });

  it('refuses a move to a category of another type, and the last one of a type in use', async () => {
    await expect(setupDelete({ uses: 2, target: category({ id: 'c2', type: 'INCOME' }) }).service.deleteCategory('biz-1', 'c1', 'c2')).rejects.toThrow(
      'Pick another expense category',
    );
    await expect(setupDelete({ uses: 2, others: 0 }).service.deleteCategory('biz-1', 'c1')).rejects.toThrow('This is the only expense category');
  });

  it('keeps Zakat for the Zakat page', async () => {
    const { service, prisma } = setupDelete();
    prisma.budgetCategory.findUnique.mockResolvedValue(category({ name: 'Zakat' }));
    await expect(service.deleteCategory('biz-1', 'c1')).rejects.toThrow('Zakat page');
    await expect(service.updateCategory('biz-1', 'c1', { name: 'Charity' })).rejects.toThrow('Zakat page');
  });

  it('changes the type of a category only while nothing uses it', async () => {
    const used = setupDelete({ uses: 1 });
    await expect(used.service.updateCategory('biz-1', 'c1', { type: 'INCOME' })).rejects.toThrow('its type stays the same');
    const unused = setupDelete();
    unused.prisma.budgetCategory.findUnique.mockImplementation(({ where }: { where: { id?: string } }) =>
      Promise.resolve(where.id === 'c1' ? category() : null),
    );
    await unused.service.updateCategory('biz-1', 'c1', { type: 'INCOME' });
    expect(unused.tx.budgetCategory.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { type: 'INCOME', monthlyLimit: null } });
  });
});
