import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccountBalanceService } from './account-balance.service.js';
import type { LedgerFilters } from './account-balance.service.js';

type Entry = { id: string; accountId: string; entryType: 'DEBIT' | 'CREDIT'; amount: string; date: string };
type DateFilter = { lt?: Date; gte?: Date; lte?: Date };

// Fixture order is posting order, so it doubles as createdAt.
const debit = (id: string, date: string, amount: string, accountId = 'acc'): Entry => ({ id, accountId, entryType: 'DEBIT', amount, date });
const credit = (id: string, date: string, amount: string, accountId = 'acc'): Entry => ({ id, accountId, entryType: 'CREDIT', amount, date });

// Just enough of Prisma's where semantics for the filters the ledger sends;
// anything else (a status or reversal filter, say) fails loudly rather than
// matching by accident.
const matchesDate = (date: Date, filter: DateFilter) =>
  (Object.entries(filter) as [string, Date][]).every(([op, bound]) => {
    if (op === 'lt') return date < bound;
    if (op === 'gte') return date >= bound;
    if (op === 'lte') return date <= bound;
    throw new Error(`The fake ledger does not support transactionDate.${op}`);
  });

const matches = (entry: Entry, where: Record<string, unknown>): boolean =>
  Object.entries(where).every(([key, value]) => {
    if (key === 'accountId' || key === 'entryType') return entry[key] === value;
    if (key === 'transaction') {
      const { transactionDate, ...rest } = value as { transactionDate?: DateFilter };
      if (Object.keys(rest).length > 0) throw new Error(`The fake ledger does not support ${JSON.stringify(rest)}`);
      return !transactionDate || matchesDate(new Date(entry.date), transactionDate);
    }
    throw new Error(`The fake ledger does not support filtering on ${key}`);
  });

const setup = (accountType: string, openingBalance: string, entries: Entry[]) => {
  const account = { id: 'acc', businessId: 'biz-1', name: 'Cash', accountType, openingBalance: new Prisma.Decimal(openingBalance) };
  const createdAt = (entry: Entry) => entries.indexOf(entry);
  const select = (where: Record<string, unknown>) => entries.filter((entry) => matches(entry, where));

  const prisma = {
    account: { findUnique: vi.fn(({ where }: { where: { id: string } }) => Promise.resolve(where.id === account.id ? account : null)) },
    transactionEntry: {
      count: vi.fn(({ where }: { where: Record<string, unknown> }) => Promise.resolve(select(where).length)),
      aggregate: vi.fn(({ where }: { where: Record<string, unknown> }) => {
        const rows = select(where);
        const amount = rows.length ? rows.reduce((sum, row) => sum.plus(row.amount), new Prisma.Decimal(0)) : null;
        return Promise.resolve({ _sum: { amount } });
      }),
      // Sorted the way the service asks (the first test pins that orderBy):
      // date, then posting time, then id.
      findMany: vi.fn(({ where, take }: { where: Record<string, unknown>; take: number; orderBy: unknown[] }) => {
        const rows = select(where)
          .sort((a, b) => a.date.localeCompare(b.date) || createdAt(a) - createdAt(b) || a.id.localeCompare(b.id))
          .slice(0, take);
        return Promise.resolve(
          rows.map((row) => ({
            id: row.id,
            transactionId: `tx-${row.id}`,
            accountId: row.accountId,
            entryType: row.entryType,
            amount: new Prisma.Decimal(row.amount),
            note: null,
            transaction: { transactionType: 'INCOME', transactionDate: new Date(row.date), description: row.id, referenceNo: null, status: 'POSTED' },
          })),
        );
      }),
    },
  };
  return { service: new AccountBalanceService(prisma as never), prisma };
};

const ledger = async (service: AccountBalanceService, filters: LedgerFilters) => {
  const result = await service.getLedger('biz-1', 'acc', filters);
  return { ...result, running: result.entries.map((row) => row.runningBalance.toFixed(2)), ids: result.entries.map((row) => row.entryId) };
};

describe('AccountBalanceService.getLedger', () => {
  it('carries the running balance across pages and gives the period closing on every page', async () => {
    const { service, prisma } = setup('ASSET', '100.00', [
      debit('e1', '2026-10-01', '50'),
      credit('e2', '2026-10-02', '20'),
      debit('elsewhere', '2026-10-02', '1000', 'other'),
      debit('e3', '2026-10-03', '10'),
      credit('e4', '2026-10-04', '5.50'),
      debit('e5', '2026-10-05', '30'),
    ]);

    const [first, second, third] = [await ledger(service, { page: 1, limit: 2 }), await ledger(service, { page: 2, limit: 2 }), await ledger(service, { page: 3, limit: 2 })];

    expect(first.ids).toEqual(['e1', 'e2']);
    expect(first.running).toEqual(['150.00', '130.00']);
    expect(first.pageOpeningBalance).toBe('100.00');
    expect(first.pageClosingBalance).toBe('130.00');

    expect(second.ids).toEqual(['e3', 'e4']);
    expect(second.pageOpeningBalance).toBe(first.running[1]);
    expect(second.running).toEqual(['140.00', '134.50']);
    expect(second.pageClosingBalance).toBe('134.50');

    expect(third.ids).toEqual(['e5']);
    expect(third.pageOpeningBalance).toBe('134.50');
    expect(third.pageClosingBalance).toBe('164.50');

    for (const page of [first, second, third]) {
      expect(page.balanceBroughtForward).toBe('100.00');
      expect(page.closingBalance).toBe('164.50');
      expect(page.meta).toEqual({ page: page.meta.page, limit: 2, total: 5, totalPages: 3 });
    }
    // The fake sorts on its own, so pin the order the service actually asks for:
    // oldest first, then posting time, then id so ties come back in one fixed order.
    expect(prisma.transactionEntry.findMany.mock.calls[0][0].orderBy).toEqual([
      { transaction: { transactionDate: 'asc' } },
      { transaction: { createdAt: 'asc' } },
      { id: 'asc' },
    ]);
  });

  it('brings forward everything before dateFrom from sums, without loading those rows', async () => {
    const { service, prisma } = setup('ASSET', '100.00', [
      debit('before-1', '2026-09-05', '40'),
      credit('before-2', '2026-09-20', '15'),
      debit('in-1', '2026-10-01', '25'),
      credit('in-2', '2026-10-15', '10'),
      debit('after', '2026-11-02', '999'),
    ]);

    const result = await ledger(service, { dateFrom: '2026-10-01', dateTo: '2026-10-31' });
    expect(result.balanceBroughtForward).toBe('125.00');
    expect(result.ids).toEqual(['in-1', 'in-2']);
    expect(result.running).toEqual(['150.00', '140.00']);
    expect(result.pageOpeningBalance).toBe('125.00');
    expect(result.closingBalance).toBe('140.00');
    expect(result.pageClosingBalance).toBe('140.00');
    expect(result.meta).toEqual({ page: 1, limit: 50, total: 2, totalPages: 1 });
    // Only the page itself is read row by row.
    expect(prisma.transactionEntry.findMany).toHaveBeenCalledTimes(1);

    const second = await ledger(service, { dateFrom: '2026-10-01', dateTo: '2026-10-31', page: 2, limit: 1 });
    expect(second.ids).toEqual(['in-2']);
    expect(second.pageOpeningBalance).toBe('150.00');
    expect(second.balanceBroughtForward).toBe('125.00');
    expect(second.closingBalance).toBe('140.00');
  });

  // The same sale and refund read in opposite directions depending on
  // which way the account's type grows.
  it.each([
    ['ASSET', ['-450.00'], '-350.00'],
    ['EXPENSE', ['-450.00'], '-350.00'],
    ['LIABILITY', ['550.00'], '450.00'],
    ['EQUITY', ['550.00'], '450.00'],
    ['INCOME', ['550.00'], '450.00'],
  ])('signs a %s account by its own direction', async (accountType, running, closing) => {
    const { service } = setup(accountType, '50.00', [credit('sale', '2026-10-01', '500'), debit('refund', '2026-10-02', '100')]);

    const result = await ledger(service, { page: 1, limit: 1 });
    expect(result.running).toEqual(running);
    expect(result.pageOpeningBalance).toBe('50.00');
    expect(result.pageClosingBalance).toBe(running[0]);
    expect(result.closingBalance).toBe(closing);
  });

  it('answers a page past the end with no rows, the real meta, and the closing balance', async () => {
    const { service } = setup('ASSET', '0.00', [debit('e1', '2026-10-01', '10'), debit('e2', '2026-10-02', '20'), credit('e3', '2026-10-03', '5')]);

    const result = await ledger(service, { page: 5, limit: 2 });
    expect(result.entries).toEqual([]);
    expect(result.meta).toEqual({ page: 5, limit: 2, total: 3, totalPages: 2 });
    expect(result.closingBalance).toBe('25.00');
    expect(result.pageOpeningBalance).toBe('25.00');
    expect(result.pageClosingBalance).toBe('25.00');
  });

  it('leaves every balance at the brought-forward figure for a period with no entries', async () => {
    const { service } = setup('ASSET', '75.00', [debit('old', '2026-09-01', '25')]);

    const result = await ledger(service, { dateFrom: '2026-10-01' });
    expect(result.entries).toEqual([]);
    expect(result.meta).toEqual({ page: 1, limit: 50, total: 0, totalPages: 0 });
    expect(result.balanceBroughtForward).toBe('100.00');
    expect(result.closingBalance).toBe('100.00');
    expect(result.pageOpeningBalance).toBe('100.00');
    expect(result.pageClosingBalance).toBe('100.00');
  });

  it("refuses another workspace's account", async () => {
    const { service } = setup('ASSET', '0.00', []);
    await expect(service.getLedger('biz-2', 'acc')).rejects.toThrow(NotFoundException);
  });
});
