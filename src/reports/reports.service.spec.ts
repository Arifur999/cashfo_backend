import { Prisma } from '@prisma/client';
import { ReportsService, UNCATEGORISED } from './reports.service.js';

const money = (n: number) => new Prisma.Decimal(n);

describe('ReportsService: income and expense by category', () => {
  const setup = (rows: { month?: string | null; category: string | null; amount: number; count: number }[]) => {
    const prisma = {
      $queryRaw: vi
        .fn()
        .mockResolvedValue(rows.map((row) => ({ month: row.month ?? null, category: row.category, amount: money(row.amount), count: row.count }))),
      budgetCategory: { findMany: vi.fn().mockResolvedValue([{ name: 'Food & Dining', color: 'orange' }]) },
    };
    return { service: new ReportsService(prisma as never), prisma };
  };

  it('counts money with no category under Uncategorised, with every row and its count', async () => {
    const { service } = setup([
      { category: 'Food & Dining', amount: 4000, count: 3 },
      { category: null, amount: 6000, count: 2 },
      ...Array.from({ length: 11 }, (_, i) => ({ category: `C${i}`, amount: 10, count: 1 })),
    ]);
    const breakdown = await service.getCategoryBreakdown('biz', { type: 'EXPENSE' });
    expect(breakdown.total).toBe('10110.00');
    expect(breakdown.categories).toHaveLength(13);
    expect(breakdown.categories[0]).toEqual({ name: UNCATEGORISED, amount: '6000.00', percent: 59, color: 'grey', count: 2, uncategorised: true });
    expect(breakdown.categories[1]).toEqual({ name: 'Food & Dining', amount: '4000.00', percent: 40, color: 'orange', count: 3 });
  });

  it('lays each month of a range out, the money with no category kept apart from a category named the same', async () => {
    const { service } = setup([
      { month: '2026-09', category: null, amount: 100, count: 1 },
      { month: '2026-10', category: null, amount: 50, count: 1 },
      { month: '2026-10', category: 'Uncategorised', amount: 7, count: 1 },
      { month: '2026-10', category: 'Food & Dining', amount: 300, count: 2 },
    ]);
    const report = await service.getMonthlyBreakdown('biz', { type: 'EXPENSE', dateFrom: '2026-09-01', dateTo: '2026-10-31' });
    expect(report.months).toEqual(['2026-09', '2026-10']);
    expect(report.rows[0]).toEqual({ name: 'Food & Dining', color: 'orange', amounts: ['0.00', '300.00'], total: '300.00' });
    expect(report.rows[1]).toEqual({ name: UNCATEGORISED, color: 'grey', amounts: ['100.00', '50.00'], total: '150.00', uncategorised: true });
    expect(report.rows[2]).toMatchObject({ name: 'Uncategorised', amounts: ['0.00', '7.00'] });
    expect(report.rows[2]).not.toHaveProperty('uncategorised');
    expect(report.totals).toEqual(['100.00', '357.00']);
  });
});
