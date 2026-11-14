import { BadRequestException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccountBalanceService } from './account-balance.service.js';
import type { LedgerFilters } from './account-balance.service.js';
import { WalletsOverviewQueryDto } from './dto/wallets-overview-query.dto.js';

// cancelled: a voided entry, or the reversal that voided one.
type Entry = { id: string; accountId: string; entryType: 'DEBIT' | 'CREDIT'; amount: string; date: string; cancelled?: boolean };
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
      const { transactionDate, status, reversalOfId, ...rest } = value as { transactionDate?: DateFilter; status?: string; reversalOfId?: null };
      if (Object.keys(rest).length > 0) throw new Error(`The fake ledger does not support ${JSON.stringify(rest)}`);
      // The standing-only filter asks for POSTED and no reversal together.
      if ((status === undefined) !== (reversalOfId === undefined)) throw new Error('The fake ledger reads status and reversalOfId together');
      if (status === 'POSTED' && entry.cancelled) return false;
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
    // No asset or savings goal owns these rows.
    asset: { findMany: vi.fn().mockResolvedValue([]) },
    savingsGoalEntry: { findMany: vi.fn().mockResolvedValue([]) },
    investmentEntry: { findMany: vi.fn().mockResolvedValue([]) },
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

describe('AccountBalanceService.getWalletsOverview', () => {
  type Tx = { id: string; businessId: string; transactionType: string; transactionDate: string; status: 'POSTED' | 'VOIDED'; reversalOfId: string | null };
  type Line = { id: string; accountId: string; entryType: 'DEBIT' | 'CREDIT'; amount: string; tx: Tx };

  const wallet = (id: string, accountSubtype: string, openingBalance: string, currentBalance: string, status = 'ACTIVE') => ({
    id,
    businessId: 'biz-1',
    name: id,
    nameBn: null,
    accountNumber: null,
    accountType: 'ASSET',
    accountSubtype,
    status,
    openingBalance: new Prisma.Decimal(openingBalance),
    currentBalance: new Prisma.Decimal(currentBalance),
  });
  const wallets = [wallet('cash', 'cash', '100', '310'), wallet('bank', 'bank', '1000', '1075'), wallet('bkash', 'mfs', '0', '0', 'ARCHIVED')];
  const subtypes: Record<string, string> = { cash: 'cash', bank: 'bank', bkash: 'mfs', sales: 'income', rent: 'expense' };

  const tx = (id: string, transactionType: string, transactionDate: string, over: Partial<Tx> = {}): Tx => ({ id, businessId: 'biz-1', transactionType, transactionDate, status: 'POSTED', reversalOfId: null, ...over });
  // Dr `debit` / Cr `credit`, one amount.
  const posting = (t: Tx, debit: string, credit: string, amount: string): Line[] => [
    { id: `${t.id}-dr`, accountId: debit, entryType: 'DEBIT', amount, tx: t },
    { id: `${t.id}-cr`, accountId: credit, entryType: 'CREDIT', amount, tx: t },
  ];
  const lines = [
    ...posting(tx('income', 'INCOME', '2026-09-10'), 'cash', 'sales', '500'),
    ...posting(tx('spend', 'EXPENSE', '2026-09-20'), 'rent', 'cash', '200'),
    ...posting(tx('move', 'TRANSFER', '2026-09-25'), 'bank', 'cash', '50'),
    // Voided after the day asked about: counted on neither side.
    ...posting(tx('void', 'INCOME', '2026-09-28', { status: 'VOIDED' }), 'bank', 'sales', '300'),
    ...posting(tx('void-rev', 'INCOME', '2026-10-02', { reversalOfId: 'void' }), 'sales', 'bank', '300'),
    // On the day itself: counted.
    ...posting(tx('last', 'INCOME', '2026-09-30'), 'bank', 'sales', '25'),
    ...posting(tx('next', 'EXPENSE', '2026-10-01'), 'rent', 'cash', '40'),
  ];

  // Just enough of Prisma's where semantics for the filters the overview
  // sends; anything else fails loudly rather than matching by accident.
  const lineMatches = (line: Line, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => {
      if (key === 'accountId') return (value as { in: string[] }).in.includes(line.accountId);
      if (key !== 'transaction') throw new Error(`The fake entries do not support filtering on ${key}`);
      return Object.entries(value as Record<string, unknown>).every(([field, filter]) => {
        if (field === 'businessId' || field === 'status' || field === 'reversalOfId') return line.tx[field] === filter;
        if (field === 'transactionType') return typeof filter === 'string' ? line.tx.transactionType === filter : line.tx.transactionType !== (filter as { not: string }).not;
        if (field === 'transactionDate') {
          const { lte, ...rest } = filter as { lte: Date };
          if (Object.keys(rest).length > 0) throw new Error(`The fake entries do not support transactionDate ${JSON.stringify(rest)}`);
          return new Date(line.tx.transactionDate) <= lte;
        }
        throw new Error(`The fake entries do not support filtering on transaction.${field}`);
      });
    });

  const setup = (accounts = wallets) => {
    const prisma = {
      account: { findMany: vi.fn().mockResolvedValue(accounts) },
      // Cash has entries; the others none yet.
      $queryRaw: vi.fn().mockResolvedValue([{ accountId: 'cash', entries: 4, lastActivity: new Date('2026-09-20T00:00:00.000Z') }]),
      transactionEntry: {
        groupBy: vi.fn(({ by, where }: { by: string[]; where: Record<string, unknown> }) => {
          if (by.join() !== 'accountId,entryType') throw new Error(`The fake entries do not group by ${by.join()}`);
          const groups = new Map<string, { accountId: string; entryType: string; _sum: { amount: Prisma.Decimal } }>();
          for (const line of lines.filter((candidate) => lineMatches(candidate, where))) {
            const key = `${line.accountId}:${line.entryType}`;
            const group = groups.get(key) ?? { accountId: line.accountId, entryType: line.entryType, _sum: { amount: new Prisma.Decimal(0) } };
            groups.set(key, { ...group, _sum: { amount: group._sum.amount.plus(line.amount) } });
          }
          return Promise.resolve([...groups.values()]);
        }),
        // The transfers, each with its whole transaction's lines.
        findMany: vi.fn(({ where }: { where: Record<string, unknown> }) =>
          Promise.resolve(
            lines
              .filter((line) => lineMatches(line, where))
              .map((line) => ({
                ...line,
                amount: new Prisma.Decimal(line.amount),
                transaction: { entries: lines.filter((other) => other.tx === line.tx).map((other) => ({ accountId: other.accountId, account: { accountSubtype: subtypes[other.accountId] } })) },
              })),
          ),
        ),
      },
    };
    return { service: new AccountBalanceService(prisma as never), prisma };
  };

  it('answers as before without asOf, from the same two queries', async () => {
    const { service, prisma } = setup();
    const overview = await service.getWalletsOverview('biz-1');

    expect(prisma.transactionEntry.groupBy).toHaveBeenCalledTimes(1);
    expect(overview).toEqual({
      totalAccounts: 3,
      totalBalance: '1385.00',
      inactiveAmount: '0.00',
      availableBalance: '1385.00',
      accounts: [
        { id: 'cash', name: 'cash', nameBn: null, accountNumber: null, accountSubtype: 'cash', status: 'ACTIVE', lastActivity: '2026-09-20', entryCount: 4, openingBalance: '100.00', totalIn: '500.00', totalOut: '240.00', savings: '0.00', adjustment: '-50.00', currentBalance: '310.00' },
        { id: 'bank', name: 'bank', nameBn: null, accountNumber: null, accountSubtype: 'bank', status: 'ACTIVE', lastActivity: null, entryCount: 0, openingBalance: '1000.00', totalIn: '25.00', totalOut: '0.00', savings: '0.00', adjustment: '50.00', currentBalance: '1075.00' },
        { id: 'bkash', name: 'bkash', nameBn: null, accountNumber: null, accountSubtype: 'mfs', status: 'ARCHIVED', lastActivity: null, entryCount: 0, openingBalance: '0.00', totalIn: '0.00', totalOut: '0.00', savings: '0.00', adjustment: '0.00', currentBalance: '0.00' },
      ],
    });
    expect(await setup().service.getWalletsOverview('biz-1', {})).toEqual(overview);
  });

  it("adds each wallet's balance at the end of asOf, from one more groupBy", async () => {
    const { service, prisma } = setup();
    const overview = await service.getWalletsOverview('biz-1', { asOf: '2026-09-30' });

    expect(prisma.transactionEntry.groupBy).toHaveBeenCalledTimes(2);
    expect(prisma.transactionEntry.groupBy.mock.calls[1][0]).toEqual({
      by: ['accountId', 'entryType'],
      where: { accountId: { in: ['cash', 'bank', 'bkash'] }, transaction: { businessId: 'biz-1', status: 'POSTED', reversalOfId: null, transactionDate: { lte: new Date('2026-09-30T00:00:00.000Z') } } },
      _sum: { amount: true },
    });
    // Cash: 100 + 500 - 200 - 50 (October's 40 is after). Bank: 1000 + 50 + 25,
    // the voided 300 and its reversal left out. bKash: only its opening.
    expect(overview.accounts.map((row) => [row.id, row.balanceAsOf])).toEqual([
      ['cash', '350.00'],
      ['bank', '1075.00'],
      ['bkash', '0.00'],
    ]);
    // Everything else as without asOf.
    const plain = await setup().service.getWalletsOverview('biz-1');
    expect({ ...overview, accounts: overview.accounts.map(({ balanceAsOf: _balanceAsOf, ...row }) => row) }).toEqual(plain);
  });

  it('reads the opening balance for a day before anything was posted', async () => {
    const { service } = setup();
    const overview = await service.getWalletsOverview('biz-1', { asOf: '2026-01-01' });
    expect(overview.accounts.map((row) => row.balanceAsOf)).toEqual(['100.00', '1000.00', '0.00']);
  });

  it('asks nothing of the entries for a workspace with no wallets', async () => {
    const { service, prisma } = setup([]);
    expect(await service.getWalletsOverview('biz-1', { asOf: '2026-09-30' })).toEqual({ totalAccounts: 0, totalBalance: '0.00', inactiveAmount: '0.00', availableBalance: '0.00', accounts: [] });
    expect(prisma.transactionEntry.groupBy).not.toHaveBeenCalled();
  });
});

describe('WalletsOverviewQueryDto', () => {
  // The global pipe, as main.ts sets it up.
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
  const parse = (query: Record<string, unknown>) => pipe.transform(query, { type: 'query', metatype: WalletsOverviewQueryDto });
  const refusal = async (query: Record<string, unknown>) => {
    const error = await parse(query).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(BadRequestException);
    return ((error as BadRequestException).getResponse() as { message: string[] }).message;
  };

  it('takes a calendar day, or none', async () => {
    await expect(parse({})).resolves.toEqual({});
    await expect(parse({ asOf: '2026-09-30' })).resolves.toEqual({ asOf: '2026-09-30' });
  });

  it('refuses other date forms, impossible days, a null and anything it does not know', async () => {
    // A month is ISO 8601 too, but not a day.
    expect(await refusal({ asOf: '2026-09' })).toEqual(['asOf must be a date in YYYY-MM-DD form']);
    expect(await refusal({ asOf: '2026-02-30' })).toEqual(['asOf must be a valid ISO 8601 date string']);
    expect(await refusal({ asOf: null })).toHaveLength(2);
    expect(await refusal({ dateFrom: '2026-09-01' })).toEqual(['property dateFrom should not exist']);
  });
});

describe('AccountBalanceService.getLedger particulars', () => {
  it("names each row's other accounts and its category, for a statement", async () => {
    const { service, prisma } = setup('ASSET', '0.00', [credit('e1', '2026-10-28', '20000.00')]);
    prisma.transactionEntry.findMany.mockResolvedValueOnce([
      {
        id: 'e1',
        transactionId: 'tx-1',
        accountId: 'acc',
        entryType: 'CREDIT',
        amount: new Prisma.Decimal('20000.00'),
        note: null,
        transaction: {
          transactionType: 'TRANSFER',
          transactionDate: new Date('2026-10-28'),
          description: null,
          referenceNo: 'TRF-1',
          status: 'POSTED',
          entries: [
            { accountId: 'acc', categoryId: null, account: { name: 'Cash Wallet' } },
            { accountId: 'mtb', categoryId: null, account: { name: 'Mutual trust bank' } },
          ],
        },
      },
    ] as never);
    const result = await service.getLedger('biz-1', 'acc');
    expect(result.entries[0]).toMatchObject({ counterAccounts: ['Mutual trust bank'], category: null });
    expect(result).toMatchObject({ accountName: 'Cash' });
  });

  it('carries the category of an income or expense', async () => {
    const { service, prisma } = setup('ASSET', '0.00', [debit('e2', '2026-10-28', '500.00')]);
    prisma.transactionEntry.findMany.mockResolvedValueOnce([
      {
        id: 'e2',
        transactionId: 'tx-2',
        accountId: 'acc',
        entryType: 'DEBIT',
        amount: new Prisma.Decimal('500.00'),
        note: 'October salary',
        transaction: {
          transactionType: 'INCOME',
          transactionDate: new Date('2026-10-28'),
          description: null,
          referenceNo: null,
          status: 'POSTED',
          entries: [
            { accountId: 'acc', categoryId: null, account: { name: 'Cash' } },
            { accountId: 'inc', categoryId: 'Salary', account: { name: 'Salary Income' } },
          ],
        },
      },
    ] as never);
    const result = await service.getLedger('biz-1', 'acc');
    expect(result.entries[0]).toMatchObject({ counterAccounts: ['Salary Income'], category: 'Salary', description: 'October salary' });
  });
});

describe('AccountBalanceService.getLedger filters', () => {
  const rows = () => [debit('salary', '2026-10-01', '1000'), credit('rent', '2026-10-02', '300'), credit('food', '2026-10-03', '45.50'), debit('gift', '2026-10-04', '200')];

  it('shows only what was received, each row with its true running balance', async () => {
    const { service } = setup('ASSET', '100.00', rows());
    const result = await ledger(service, { direction: 'in' });
    expect(result.ids).toEqual(['salary', 'gift']);
    expect(result.running).toEqual(['1100.00', '954.50']);
    expect(result.counts).toEqual({ all: 4, in: 2, out: 2 });
    expect(result.filtered).toBe(true);
    expect(result.meta).toEqual({ page: 1, limit: 50, total: 2, totalPages: 1 });
    // The period's figures stay the period's.
    expect(result.balanceBroughtForward).toBe('100.00');
    expect(result.closingBalance).toBe('954.50');
  });

  it('finds a row by its note or its amount, commas or not', async () => {
    const { service } = setup('ASSET', '0.00', rows());
    expect((await ledger(service, { search: 'RENT' })).ids).toEqual(['rent']);
    expect((await ledger(service, { search: '1,000' })).ids).toEqual(['salary']);
    expect((await ledger(service, { search: '45.5' })).ids).toEqual(['food']);
  });

  it('keeps one kind, and says which kinds the period has', async () => {
    const { service } = setup('ASSET', '0.00', rows());
    const all = await ledger(service, {});
    expect(all.kinds).toEqual(['INCOME']);
    expect(all.filtered).toBe(false);
    expect((await ledger(service, { kind: 'EXPENSE' })).ids).toEqual([]);
    expect((await ledger(service, { kind: 'INCOME' })).ids).toEqual(['salary', 'rent', 'food', 'gift']);
  });

  it('pages the filtered rows', async () => {
    const { service } = setup('ASSET', '0.00', rows());
    const second = await ledger(service, { direction: 'out', page: 2, limit: 1 });
    expect(second.ids).toEqual(['food']);
    expect(second.pageOpeningBalance).toBe('700.00');
    expect(second.pageClosingBalance).toBe('654.50');
    expect(second.meta).toEqual({ page: 2, limit: 1, total: 2, totalPages: 2 });
  });
});

describe('AccountBalanceService.getLedger standing only', () => {
  it('works the balances out without a voided entry and its reversal', async () => {
    const { service } = setup('ASSET', '100.00', [
      debit('salary', '2026-09-30', '1000'),
      credit('sent', '2026-10-02', '400', 'acc'),
      debit('voided', '2026-10-03', '250'),
      credit('reversal', '2026-10-20', '250'),
      credit('rent', '2026-10-05', '300'),
    ].map((entry) => (entry.id === 'voided' || entry.id === 'reversal' ? { ...entry, cancelled: true } : entry)));

    const all = await ledger(service, { dateFrom: '2026-10-01' });
    expect(all.ids).toEqual(['sent', 'voided', 'rent', 'reversal']);

    const standing = await ledger(service, { dateFrom: '2026-10-01', standingOnly: true });
    expect(standing.ids).toEqual(['sent', 'rent']);
    expect(standing.balanceBroughtForward).toBe('1100.00');
    expect(standing.running).toEqual(['700.00', '400.00']);
    // The pair nets to zero, so the closing balance is the same either way.
    expect(standing.closingBalance).toBe(all.closingBalance);
  });
});
