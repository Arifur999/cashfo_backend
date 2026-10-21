import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccountsController } from './accounts.controller.js';
import { AccountsService } from './accounts.service.js';
import { ListAccountsQueryDto } from './dto/list-accounts-query.dto.js';

const receivable = { id: 'ar', businessId: 'biz-1', accountType: 'ASSET', accountSubtype: 'receivable', isSystemAccount: true, status: 'ACTIVE', parentId: null };

const setup = (rows: Record<string, { id: string; businessId: string; accountType: string; accountSubtype: string | null; isSystemAccount: boolean; status: string; parentId: string | null }>) => {
  const prisma = {
    account: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) => Promise.resolve(rows[where.id] ?? null)),
      create: vi.fn().mockResolvedValue({ id: 'new' }),
      update: vi.fn().mockResolvedValue({ id: 'updated' }),
      count: vi.fn().mockResolvedValue(0),
      delete: vi.fn().mockResolvedValue({}),
    },
    transactionEntry: { count: vi.fn().mockResolvedValue(0) },
  };
  return { service: new AccountsService(prisma as never), prisma };
};

describe('AccountsService reserved system accounts', () => {
  it('refuses a new account with a reserved subtype', async () => {
    const { service, prisma } = setup({});
    await expect(service.create('biz-1', { name: 'Staff advance', accountType: 'ASSET', accountSubtype: 'receivable' })).rejects.toThrow(BadRequestException);
    expect(prisma.account.create).not.toHaveBeenCalled();
  });

  it("refuses to change the system receivable's subtype", async () => {
    const { service, prisma } = setup({ ar: receivable });
    await expect(service.update('biz-1', 'ar', { accountSubtype: 'loan' })).rejects.toThrow(BadRequestException);
    expect(prisma.account.update).not.toHaveBeenCalled();
  });

  it('still lets the system receivable be renamed', async () => {
    const { service, prisma } = setup({ ar: receivable });
    await service.update('biz-1', 'ar', { name: 'Customers owe me', accountSubtype: 'receivable' });
    expect(prisma.account.update).toHaveBeenCalled();
  });

  it('refuses to archive or remove the system receivable', async () => {
    const { service, prisma } = setup({ ar: receivable });
    await expect(service.archive('biz-1', 'ar')).rejects.toThrow(BadRequestException);
    await expect(service.removeOrArchive('biz-1', 'ar')).rejects.toThrow(BadRequestException);
    expect(prisma.account.delete).not.toHaveBeenCalled();
  });
});

describe('AccountsService.update parent', () => {
  const base = { businessId: 'biz-1', accountType: 'EXPENSE', accountSubtype: null, isSystemAccount: false, status: 'ACTIVE' };

  it('refuses to move an account under its own descendant', async () => {
    const { service, prisma } = setup({
      a: { id: 'a', ...base, parentId: null },
      b: { id: 'b', ...base, parentId: 'a' },
      c: { id: 'c', ...base, parentId: 'b' },
    });
    await expect(service.update('biz-1', 'a', { parentId: 'c' })).rejects.toThrow(BadRequestException);
    expect(prisma.account.update).not.toHaveBeenCalled();
  });

  it('allows moving under an unrelated account', async () => {
    const { service, prisma } = setup({
      a: { id: 'a', ...base, parentId: null },
      x: { id: 'x', ...base, parentId: null },
    });
    await service.update('biz-1', 'a', { parentId: 'x' });
    expect(prisma.account.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: { parentId: 'x' } });
  });
});

describe('AccountsService.list', () => {
  type Tx = { id: string; businessId: string; transactionDate: string; status: 'POSTED' | 'VOIDED'; reversalOfId: string | null };
  type Line = { accountId: string; entryType: 'DEBIT' | 'CREDIT'; amount: string; tx: Tx };
  type DateFilter = { gte?: Date; lte?: Date };

  const account = (id: string, accountType: string, parentId: string | null = null) => ({
    id,
    businessId: 'biz-1',
    name: id,
    accountType,
    accountSubtype: null,
    parentId,
    status: 'ACTIVE',
    displayOrder: 0,
    isSystemAccount: false,
    openingBalance: new Prisma.Decimal(0),
    currentBalance: new Prisma.Decimal(0),
  });
  // In the order the service asks for: by type, then display order.
  const accounts = [
    account('cash', 'ASSET'),
    account('bank', 'ASSET'),
    account('loan', 'LIABILITY'),
    account('sales', 'INCOME'),
    account('online', 'INCOME', 'sales'),
    account('rent', 'EXPENSE'),
    account('stationery', 'EXPENSE'),
  ];

  const tx = (id: string, transactionDate: string, over: Partial<Tx> = {}): Tx => ({ id, businessId: 'biz-1', transactionDate, status: 'POSTED', reversalOfId: null, ...over });
  // Dr `debit` / Cr `credit`, one amount.
  const posting = (t: Tx, debit: string, credit: string, amount: string): Line[] => [
    { accountId: debit, entryType: 'DEBIT', amount, tx: t },
    { accountId: credit, entryType: 'CREDIT', amount, tx: t },
  ];
  const lines = [
    ...posting(tx('last-year', '2025-12-31'), 'cash', 'sales', '50'),
    ...posting(tx('sale', '2026-03-10'), 'cash', 'sales', '1000'),
    ...posting(tx('online-sale', '2026-04-02'), 'cash', 'online', '300'),
    // A refund debits the income it gave back.
    ...posting(tx('refund', '2026-04-05'), 'sales', 'cash', '100'),
    ...posting(tx('rent', '2026-05-01'), 'rent', 'cash', '500'),
    // Voided, and its reversal: neither counts.
    ...posting(tx('void', '2026-05-02', { status: 'VOIDED' }), 'rent', 'cash', '999'),
    ...posting(tx('void-rev', '2026-05-03', { reversalOfId: 'void' }), 'cash', 'rent', '999'),
    ...posting(tx('borrowed', '2026-06-01'), 'cash', 'loan', '2000'),
    ...posting(tx('repaid', '2026-06-15'), 'loan', 'cash', '500'),
    // Wallet to wallet: counted like any other entry.
    ...posting(tx('transfer', '2026-07-01'), 'bank', 'cash', '200'),
    ...posting(tx('next-year', '2027-01-01'), 'rent', 'cash', '70'),
    ...posting(tx('elsewhere', '2026-03-10', { businessId: 'biz-2' }), 'their-cash', 'their-sales', '5000'),
  ];

  // Just enough of Prisma's where semantics for the filters the list sends;
  // anything else fails loudly rather than matching by accident.
  const inWindow = (date: Date, filter: DateFilter) =>
    (Object.entries(filter) as [string, Date][]).every(([op, bound]) => {
      if (op === 'gte') return date >= bound;
      if (op === 'lte') return date <= bound;
      throw new Error(`The fake entries do not support transactionDate.${op}`);
    });
  const lineMatches = (line: Line, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => {
      if (key === 'accountId') return (value as { in: string[] }).in.includes(line.accountId);
      if (key !== 'transaction') throw new Error(`The fake entries do not support filtering on ${key}`);
      return Object.entries(value as Record<string, unknown>).every(([field, filter]) => {
        if (field === 'transactionDate') return inWindow(new Date(line.tx.transactionDate), filter as DateFilter);
        if (field === 'businessId' || field === 'status' || field === 'reversalOfId') return line.tx[field] === filter;
        throw new Error(`The fake entries do not support filtering on transaction.${field}`);
      });
    });

  const setup = (rows = accounts) => {
    const prisma = {
      account: { findMany: vi.fn().mockResolvedValue(rows) },
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
      },
    };
    return { service: new AccountsService(prisma as never), prisma };
  };

  type Node = Record<string, unknown> & { id: string; children: Node[] };
  const everyAccount = (groups: { accounts: unknown[] }[]): Node[] => {
    const walk = (node: Node): Node[] => [node, ...node.children.flatMap(walk)];
    return groups.flatMap((group) => (group.accounts as Node[]).flatMap(walk));
  };
  const figures = (groups: { accounts: unknown[] }[]) => Object.fromEntries(everyAccount(groups).map((node) => [node.id, [node.periodDebit, node.periodCredit, node.periodNet]]));

  it('answers as before without dates, from no entry query', async () => {
    const { service, prisma } = setup();
    const groups = await service.list('biz-1');

    expect(prisma.transactionEntry.groupBy).not.toHaveBeenCalled();
    expect(groups.map((group) => [group.accountType, group.accounts.map((a) => a.id)])).toEqual([
      ['ASSET', ['cash', 'bank']],
      ['LIABILITY', ['loan']],
      ['EQUITY', []],
      ['INCOME', ['sales']],
      ['EXPENSE', ['rent', 'stationery']],
    ]);
    const nodes = everyAccount(groups);
    expect(nodes.map((node) => node.id)).toEqual(['cash', 'bank', 'loan', 'sales', 'online', 'rent', 'stationery']);
    // Exactly the account and its children, nothing added.
    for (const node of nodes) expect(Object.keys(node).sort()).toEqual([...Object.keys(accounts[0]), 'children'].sort());
    expect(await setup().service.list('biz-1', {})).toEqual(groups);
  });

  it("adds every account's standing entries in the period, from one groupBy, signed the way it grows", async () => {
    const { service, prisma } = setup();
    const groups = await service.list('biz-1', { dateFrom: '2026-01-01', dateTo: '2026-12-31' });

    expect(prisma.transactionEntry.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.transactionEntry.groupBy.mock.calls[0][0]).toEqual({
      by: ['accountId', 'entryType'],
      where: {
        accountId: { in: accounts.map((a) => a.id) },
        transaction: { businessId: 'biz-1', status: 'POSTED', reversalOfId: null, transactionDate: { gte: new Date('2026-01-01T00:00:00.000Z'), lte: new Date('2026-12-31T00:00:00.000Z') } },
      },
      _sum: { amount: true },
    });
    expect(figures(groups)).toEqual({
      cash: ['3300.00', '1300.00', '2000.00'],
      bank: ['200.00', '0.00', '200.00'],
      loan: ['500.00', '2000.00', '1500.00'],
      // Sales less the refund; the child's own sales stay the child's.
      sales: ['100.00', '1000.00', '900.00'],
      online: ['0.00', '300.00', '300.00'],
      rent: ['500.00', '0.00', '500.00'],
      stationery: ['0.00', '0.00', '0.00'],
    });
    // The rest of each account is as it was.
    const [cash] = everyAccount(groups);
    expect(cash).toMatchObject({ ...accounts[0], children: [] });
  });

  it('takes a period open at either end', async () => {
    const windowAsked = (prisma: ReturnType<typeof setup>['prisma']) => (prisma.transactionEntry.groupBy.mock.calls[0][0].where.transaction as { transactionDate: unknown }).transactionDate;

    const from = setup();
    const after = await from.service.list('biz-1', { dateFrom: '2026-06-01' });
    expect(windowAsked(from.prisma)).toStrictEqual({ gte: new Date('2026-06-01T00:00:00.000Z') });
    // Borrowed 2000; repaid 500, moved 200 to the bank and paid next year's 70.
    expect(figures(after).cash).toEqual(['2000.00', '770.00', '1230.00']);

    const to = setup();
    const before = await to.service.list('biz-1', { dateTo: '2025-12-31' });
    expect(windowAsked(to.prisma)).toStrictEqual({ lte: new Date('2025-12-31T00:00:00.000Z') });
    expect(figures(before).sales).toEqual(['0.00', '50.00', '50.00']);
  });

  it('counts a one-day period, that day included', async () => {
    const { service } = setup();
    expect(figures(await service.list('biz-1', { dateFrom: '2026-04-05', dateTo: '2026-04-05' })).sales).toEqual(['100.00', '0.00', '-100.00']);
  });

  it('asks nothing of the entries for a workspace with no accounts', async () => {
    const { service, prisma } = setup([]);
    expect((await service.list('biz-1', { dateFrom: '2026-01-01' })).every((group) => group.accounts.length === 0)).toBe(true);
    expect(prisma.transactionEntry.groupBy).not.toHaveBeenCalled();
  });

  it('refuses a dateFrom after the dateTo', async () => {
    const { service, prisma } = setup();
    await expect(service.list('biz-1', { dateFrom: '2026-12-31', dateTo: '2026-01-01' })).rejects.toThrow(BadRequestException);
    expect(prisma.account.findMany).not.toHaveBeenCalled();
  });
});

describe('AccountsController period and asOf', () => {
  it('hands the dates to the account list and asOf to the wallets overview', () => {
    const accounts = { list: vi.fn() };
    const balances = { getWalletsOverview: vi.fn() };
    const controller = new AccountsController(accounts as never, balances as never);

    controller.list('biz-1', {});
    controller.list('biz-1', { dateFrom: '2026-01-01', dateTo: '2026-10-21' });
    controller.walletsOverview('biz-1', {});
    controller.walletsOverview('biz-1', { asOf: '2026-09-30' });

    expect(accounts.list.mock.calls).toEqual([
      ['biz-1', {}],
      ['biz-1', { dateFrom: '2026-01-01', dateTo: '2026-10-21' }],
    ]);
    expect(balances.getWalletsOverview.mock.calls).toEqual([
      ['biz-1', {}],
      ['biz-1', { asOf: '2026-09-30' }],
    ]);
  });
});

describe('ListAccountsQueryDto', () => {
  // The global pipe, as main.ts sets it up.
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
  const parse = (query: Record<string, unknown>) => pipe.transform(query, { type: 'query', metatype: ListAccountsQueryDto });
  const refusal = async (query: Record<string, unknown>) => {
    const error = await parse(query).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(BadRequestException);
    return ((error as BadRequestException).getResponse() as { message: string[] }).message;
  };

  it('takes calendar days, either or both, or none', async () => {
    await expect(parse({})).resolves.toEqual({});
    await expect(parse({ dateFrom: '2026-01-01', dateTo: '2026-12-31' })).resolves.toEqual({ dateFrom: '2026-01-01', dateTo: '2026-12-31' });
    await expect(parse({ dateTo: '2026-02-28' })).resolves.toEqual({ dateTo: '2026-02-28' });
  });

  it('refuses other date forms, impossible days, a null and anything it does not know', async () => {
    expect(await refusal({ dateFrom: '2026-W10' })).toEqual(['dateFrom must be a date in YYYY-MM-DD form']);
    expect(await refusal({ dateTo: '2026-02-30' })).toEqual(['dateTo must be a valid ISO 8601 date string']);
    expect(await refusal({ dateFrom: null })).toHaveLength(2);
    expect(await refusal({ type: 'INCOME' })).toEqual(['property type should not exist']);
  });
});
