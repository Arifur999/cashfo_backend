import { Prisma } from '@prisma/client';
import { TransactionsService } from './transactions.service.js';
import type { ListTransactionsQueryDto } from './dto/list-transactions-query.dto.js';

type Row = { id: string; businessId: string; transactionType: string; status: string; reversalOfId: string | null; debit: string };

// One workspace's ledger: a standing income, a voided income and the
// reversal that undid it, an expense, a transfer, a sale (no total of its
// own), and another workspace's income that must never show up.
const ledger: Row[] = [
  { id: 'income', businessId: 'biz-1', transactionType: 'INCOME', status: 'POSTED', reversalOfId: null, debit: '1000' },
  { id: 'voided', businessId: 'biz-1', transactionType: 'INCOME', status: 'VOIDED', reversalOfId: null, debit: '400' },
  { id: 'reversal', businessId: 'biz-1', transactionType: 'INCOME', status: 'POSTED', reversalOfId: 'voided', debit: '400' },
  { id: 'expense', businessId: 'biz-1', transactionType: 'EXPENSE', status: 'POSTED', reversalOfId: null, debit: '250.5' },
  { id: 'transfer', businessId: 'biz-1', transactionType: 'TRANSFER', status: 'POSTED', reversalOfId: null, debit: '300' },
  { id: 'sale', businessId: 'biz-1', transactionType: 'SALE', status: 'POSTED', reversalOfId: null, debit: '999' },
  { id: 'elsewhere', businessId: 'biz-2', transactionType: 'INCOME', status: 'POSTED', reversalOfId: null, debit: '5000' },
];

// Just enough of Prisma's where semantics for the filters these tests send;
// anything else fails loudly rather than matching by accident.
const matches = (row: Row, where: Record<string, unknown>): boolean =>
  Object.entries(where).every(([key, value]) => {
    if (key === 'AND') return (value as Record<string, unknown>[]).every((part) => matches(row, part));
    if (!(key in row)) throw new Error(`The fake ledger does not support filtering on ${key}`);
    if (value !== null && typeof value === 'object') {
      if (!('in' in value)) throw new Error(`The fake ledger does not support ${JSON.stringify(value)}`);
      return (value.in as unknown[]).includes(row[key as keyof Row]);
    }
    return row[key as keyof Row] === value;
  });

const setup = () => {
  const prisma = {
    transaction: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn(({ where }: { where: Record<string, unknown> }) => Promise.resolve(ledger.filter((row) => matches(row, where)).length)),
    },
    transactionEntry: {
      // Each fixture row carries only its debit side, which is all the
      // summary ever sums.
      aggregate: vi.fn(({ where }: { where: { entryType: string; transaction: Record<string, unknown> } }) => {
        const rows = where.entryType === 'DEBIT' ? ledger.filter((row) => matches(row, where.transaction)) : [];
        const amount = rows.length ? rows.reduce((sum, row) => sum.plus(row.debit), new Prisma.Decimal(0)) : null;
        return Promise.resolve({ _sum: { amount } });
      }),
    },
  };
  const service = new TransactionsService(prisma as never, {} as never);
  return { service, prisma };
};

const filters = (overrides: Partial<ListTransactionsQueryDto> = {}) => overrides as ListTransactionsQueryDto;

describe('TransactionsService.summarizeTransactions', () => {
  it('counts every matching transaction and the voided originals among them', async () => {
    const { service } = setup();
    const summary = await service.summarizeTransactions('biz-1', filters());
    expect(summary.count).toBe(6);
    expect(summary.voided).toBe(1);
  });

  it("totals each type's standing transactions, leaving out a voided entry and its reversal", async () => {
    const { service } = setup();
    const { totals } = await service.summarizeTransactions('biz-1', filters());
    expect(totals).toEqual({ INCOME: '1000.00', EXPENSE: '250.50', TRANSFER: '300.00' });
  });

  it('sums only debit entries, so a balanced transaction counts once', async () => {
    const { service, prisma } = setup();
    await service.summarizeTransactions('biz-1', filters());
    for (const [args] of prisma.transactionEntry.aggregate.mock.calls) {
      expect(args.where.entryType).toBe('DEBIT');
    }
  });

  it('narrows to a type filter instead of overriding it', async () => {
    const { service } = setup();
    const summary = await service.summarizeTransactions('biz-1', filters({ transactionType: 'EXPENSE' }));
    expect(summary).toEqual({ count: 1, voided: 0, totals: { INCOME: '0.00', EXPENSE: '250.50', TRANSFER: '0.00' } });
  });

  it('narrows to a status filter instead of overriding it', async () => {
    const { service } = setup();
    const voidedOnly = await service.summarizeTransactions('biz-1', filters({ status: 'VOIDED' }));
    expect(voidedOnly).toEqual({ count: 1, voided: 1, totals: { INCOME: '0.00', EXPENSE: '0.00', TRANSFER: '0.00' } });
    const postedOnly = await service.summarizeTransactions('biz-1', filters({ status: 'POSTED' }));
    expect(postedOnly.voided).toBe(0);
    expect(postedOnly.totals.INCOME).toBe('1000.00');
  });

  it("filters exactly as the list does, whatever the visitor picked, and ignores the list's page", async () => {
    const { service, prisma } = setup();
    // Only the arguments matter here; the fake ledger can't evaluate these filters.
    prisma.transaction.count.mockImplementation(() => Promise.resolve(0));
    prisma.transactionEntry.aggregate.mockImplementation(() => Promise.resolve({ _sum: { amount: null } }));
    // Every filter the list takes, so a new one added to only one side fails here.
    const query = filters({
      dateFrom: '2026-10-01',
      dateTo: '2026-10-31',
      transactionTypes: ['INCOME', 'EXPENSE'],
      status: 'POSTED',
      accountId: 'cash',
      categoryId: 'Food',
      contactId: 'contact-1',
      contactCategory: 'LOAN',
      search: 'lunch',
    });

    await service.listTransactions('biz-1', { ...query, page: 3, limit: 5 });
    const listWhere = prisma.transaction.count.mock.calls[0][0].where;
    await service.summarizeTransactions('biz-1', { ...query, page: 3, limit: 5 });

    expect(listWhere).toMatchObject({
      businessId: 'biz-1',
      transactionDate: { gte: new Date('2026-10-01'), lte: new Date('2026-10-31') },
      transactionType: { in: ['INCOME', 'EXPENSE'] },
      status: 'POSTED',
      entries: { some: { accountId: 'cash', categoryId: 'Food' } },
      contactId: 'contact-1',
      contact: { category: 'LOAN' },
      OR: expect.arrayContaining([{ description: { contains: 'lunch', mode: 'insensitive' } }]),
    });
    const [countCall, voidedCall] = prisma.transaction.count.mock.calls.slice(1);
    expect(countCall[0].where).toEqual(listWhere);
    expect(voidedCall[0].where).toEqual({ AND: [listWhere, { status: 'VOIDED', reversalOfId: null }] });
    const totalFilters = prisma.transactionEntry.aggregate.mock.calls.map(([args]) => args.where.transaction.AND as Record<string, unknown>[]);
    for (const [list, standing] of totalFilters) {
      expect(list).toEqual(listWhere);
      expect(standing).toEqual({ status: 'POSTED', reversalOfId: null });
    }
    expect(totalFilters.map((parts) => parts[2])).toEqual([{ transactionType: 'INCOME' }, { transactionType: 'EXPENSE' }, { transactionType: 'TRANSFER' }]);
  });
});
