import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { InvestmentDto } from './dto/investment.dto.js';
import { capitalStaysPositive, figuresOf } from './investment-figures.js';
import { INVESTMENT_DELETED_REASON, INVESTMENT_ENTRY_DELETED_REASON, INVESTMENT_PROFIT_CATEGORY, InvestmentsService } from './investments.service.js';

type Row = Record<string, any>;

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

// A workspace in memory: wallets, an income account, investments with their
// entries, and the postings TransactionsService makes and voids.
const setup = () => {
  const accounts: Row[] = [
    { id: 'islami', businessId: 'b1', name: 'Islami bank', accountType: 'ASSET', accountSubtype: 'bank', status: 'ACTIVE' },
    { id: 'cash', businessId: 'b1', name: 'Cash', accountType: 'ASSET', accountSubtype: 'cash', status: 'ACTIVE' },
    { id: 'old', businessId: 'b1', name: 'Old wallet', accountType: 'ASSET', accountSubtype: 'cash', status: 'ARCHIVED' },
    { id: 'savings', businessId: 'b1', name: 'DPS', accountType: 'ASSET', accountSubtype: 'savings', status: 'ACTIVE' },
    { id: 'sales', businessId: 'b1', name: 'Sales', accountType: 'INCOME', status: 'ACTIVE' },
    { id: 'profit-inc', businessId: 'b1', name: 'Profit income', accountType: 'INCOME', status: 'ACTIVE' },
  ];
  const investments: Row[] = [];
  let entries: Row[] = [];
  const deletions: Row[] = [];
  const postings: Row[] = [];
  let seq = 0;
  const id = (prefix: string) => `${prefix}-${++seq}`;
  const withEntries = (row: Row | undefined) =>
    row
      ? {
          ...row,
          entries: entries
            .filter((entry) => entry.investmentId === row.id)
            .sort((a, b) => a.date.getTime() - b.date.getTime() || a.createdAt.getTime() - b.createdAt.getTime()),
        }
      : null;
  const prisma: Row = {
    account: {
      findUnique: vi.fn(({ where }) => Promise.resolve(accounts.find((a) => a.id === where.id) ?? null)),
      findMany: vi.fn(({ where }) => Promise.resolve(accounts.filter((a) => a.accountType === where.accountType && a.status === where.status))),
      findFirst: vi.fn(({ where }) => Promise.resolve(accounts.find((a) => a.accountSubtype === where.accountSubtype) ?? null)),
      create: vi.fn(({ data }) => {
        const row = { id: 'pool', ...data };
        accounts.push(row);
        return Promise.resolve(row);
      }),
    },
    investment: {
      create: vi.fn(({ data }) => {
        const row = { id: data.id ?? id('inv'), closedAt: null, createdAt: new Date(), updatedAt: new Date(), ...data };
        investments.push(row);
        return Promise.resolve(row);
      }),
      findUnique: vi.fn(({ where }) => Promise.resolve(withEntries(investments.find((i) => i.id === where.id)))),
      findUniqueOrThrow: vi.fn(({ where }) => Promise.resolve(withEntries(investments.find((i) => i.id === where.id)))),
      update: vi.fn(({ where, data }) => {
        const row = investments.find((i) => i.id === where.id)!;
        Object.assign(row, data);
        return Promise.resolve(row);
      }),
      delete: vi.fn(({ where }) => {
        investments.splice(
          investments.findIndex((i) => i.id === where.id),
          1,
        );
        return Promise.resolve({});
      }),
    },
    investmentEntry: {
      create: vi.fn(({ data }) => {
        const row = { id: id('e'), note: null, fromClose: false, createdAt: new Date(Date.now() + seq), ...data, amount: new Prisma.Decimal(data.amount) };
        entries.push(row);
        return Promise.resolve(row);
      }),
      createMany: vi.fn(({ data }) => {
        entries.push(...data.map((row: Row) => ({ ...row, amount: new Prisma.Decimal(row.amount) })));
        return Promise.resolve({ count: data.length });
      }),
      findUnique: vi.fn(({ where }) => Promise.resolve(entries.find((e) => e.id === where.id) ?? null)),
      update: vi.fn(({ where, data }) => {
        Object.assign(
          entries.find((e) => e.id === where.id)!,
          data,
        );
        return Promise.resolve({});
      }),
      updateMany: vi.fn(({ where, data }) => {
        entries
          .filter((e) => (!where.id || e.id === where.id) && (!where.investmentId || e.investmentId === where.investmentId))
          .forEach((e) => Object.assign(e, data));
        return Promise.resolve({ count: 1 });
      }),
      delete: vi.fn(({ where }) => {
        entries = entries.filter((e) => e.id !== where.id);
        return Promise.resolve({});
      }),
      deleteMany: vi.fn(({ where }) => {
        entries = entries.filter((e) => e.investmentId !== where.investmentId);
        return Promise.resolve({});
      }),
    },
    investmentDeletion: {
      upsert: vi.fn(({ create }) => {
        deletions.push({ ...create, deletedAt: new Date() });
        return Promise.resolve({});
      }),
      findUnique: vi.fn(({ where }) => Promise.resolve(deletions.find((d) => d.id === where.id) ?? null)),
      deleteMany: vi.fn(({ where }) => {
        const before = deletions.length;
        for (let i = deletions.length - 1; i >= 0; i--)
          if (
            (where.id && deletions[i].id === where.id) ||
            (where.investmentId && deletions[i].investmentId === where.investmentId && deletions[i].kind === where.kind)
          )
            deletions.splice(i, 1);
        return Promise.resolve({ count: before - deletions.length });
      }),
    },
    transaction: { findUnique: vi.fn(({ where }) => Promise.resolve(postings.find((p) => p.id === where.id) ?? null)) },
  };
  const transactions = {
    withLocks: vi.fn((_keys: string[], work: (tx: unknown) => unknown) => work(prisma)),
    createTransaction: vi.fn((_b: string, dto: Row) => {
      const row = { id: id('t'), status: 'POSTED', ...dto };
      postings.push(row);
      return Promise.resolve(row);
    }),
    voidTransaction: vi.fn((_b: string, transactionId: string, reason: string) => {
      Object.assign(
        postings.find((p) => p.id === transactionId)!,
        { status: 'VOIDED', reason },
      );
      return Promise.resolve({});
    }),
    reinstateVoided: vi.fn((_tx: unknown, _b: string, transactionId: string, reason: string) => {
      const posting = postings.find((p) => p.id === transactionId)!;
      if (posting.reason !== reason) return Promise.resolve(false);
      Object.assign(posting, { status: 'POSTED', reason: null });
      return Promise.resolve(true);
    }),
  };
  const service = new InvestmentsService(prisma as never, transactions as never);
  return { service, prisma, transactions, postings, deletions, entriesOf: () => entries };
};

const form = (patch: Partial<InvestmentDto> = {}): InvestmentDto => ({
  name: 'Karim Garments partnership',
  kind: 'BUSINESS',
  amount: 1_000_000,
  startDate: '2025-07-01',
  sourceAccountId: 'islami',
  frequency: 'MONTHLY',
  payoutMode: 'RATE',
  ratePercent: 18,
  fixedAmount: null,
  firstDueDate: '2025-08-05',
  maturityDate: null,
  profitAccountId: 'islami',
  note: 'Sleeping partner',
  ...patch,
});

describe('investment figures', () => {
  const entries = [
    { type: 'INVEST' as const, amount: 100_000, day: '2026-01-01' },
    { type: 'PROFIT' as const, amount: 2_000, day: '2026-02-01' },
    { type: 'BACK' as const, amount: 30_000, day: '2026-03-01' },
    { type: 'LOSS' as const, amount: 10_000, day: '2026-04-01' },
    { type: 'ADD' as const, amount: 5_000, day: '2026-05-01' },
  ];
  it('works capital out of what was put in, came back and was lost', () => {
    const all = figuresOf(entries);
    expect([all.put, all.back, all.loss, all.profit, all.capital].map(Number)).toEqual([105_000, 30_000, 10_000, 2_000, 65_000]);
    expect(Number(figuresOf(entries, '2026-03-15').capital)).toBe(70_000);
  });

  it('refuses capital below zero on any day, not only at the end', () => {
    expect(capitalStaysPositive(entries)).toBe(true);
    // Taking 90,000 back in March: the top-up in May would cover it, March can't.
    expect(capitalStaysPositive([...entries, { type: 'BACK', amount: 65_000, day: '2026-03-02' }])).toBe(false);
    expect(capitalStaysPositive([...entries, { type: 'BACK', amount: 65_000, day: '2026-06-01' }])).toBe(true);
  });
});

describe('InvestmentsService', () => {
  it('puts the money in from the wallet through the pooled investments account', async () => {
    const { service, transactions, entriesOf } = setup();
    const made = await service.create('b1', form(), 'u1');
    expect(made.capital).toBe('1000000.00');
    expect(transactions.createTransaction).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({
        transactionType: 'JOURNAL',
        transactionDate: '2025-07-01',
        entries: [
          { accountId: 'pool', entryType: 'DEBIT', amount: 1_000_000 },
          { accountId: 'islami', entryType: 'CREDIT', amount: 1_000_000, note: undefined },
        ],
      }),
      'u1',
      expect.anything(),
    );
    expect(entriesOf()).toEqual([expect.objectContaining({ type: 'INVEST', accountId: 'islami', transactionId: expect.any(String) })]);
    expect(made).toMatchObject({ payoutMode: 'RATE', ratePercent: 18, fixedAmount: null, firstDueDate: day('2025-08-05') });
  });

  it('records money put in earlier with no posting, and keeps an irregular plan without amount or dates', async () => {
    const { service, transactions } = setup();
    const made = await service.create(
      'b1',
      form({ sourceAccountId: null, frequency: 'IRREGULAR', payoutMode: 'RATE', ratePercent: 12, firstDueDate: '2025-08-05' }),
      'u1',
    );
    expect(transactions.createTransaction).not.toHaveBeenCalled();
    expect(made).toMatchObject({ capital: '1000000.00', payoutMode: 'NONE', ratePercent: null, firstDueDate: null });
    expect(made.entries[0]).toMatchObject({ accountId: null, transactionId: null });
  });

  it('refuses a plan the form would refuse', async () => {
    const { service } = setup();
    await expect(service.create('b1', form({ firstDueDate: '2025-07-01' }), 'u1')).rejects.toThrow(BadRequestException);
    await expect(service.create('b1', form({ firstDueDate: null }), 'u1')).rejects.toThrow(BadRequestException);
    await expect(service.create('b1', form({ maturityDate: '2025-06-01' }), 'u1')).rejects.toThrow(BadRequestException);
    await expect(service.create('b1', form({ startDate: '2999-01-01' }), 'u1')).rejects.toThrow(BadRequestException);
    // Only cash, bank and mobile wallets in use.
    await expect(service.create('b1', form({ sourceAccountId: 'savings' }), 'u1')).rejects.toThrow(BadRequestException);
    await expect(service.create('b1', form({ sourceAccountId: 'old' }), 'u1')).rejects.toThrow(BadRequestException);
  });

  it('posts a profit as income into the wallet, under the investment profit category', async () => {
    const { service, transactions } = setup();
    const made = await service.create('b1', form(), 'u1');
    const { investment } = await service.addEntry(
      'b1',
      made.id,
      { type: 'PROFIT', amount: 15_000, date: '2025-08-05', accountId: 'islami', note: 'August share' },
      'u1',
    );
    expect(transactions.createTransaction).toHaveBeenLastCalledWith(
      'b1',
      expect.objectContaining({
        transactionType: 'INCOME',
        description: 'Investment profit: Karim Garments partnership -- August share',
        entries: [
          { accountId: 'islami', entryType: 'DEBIT', amount: 15_000 },
          { accountId: 'profit-inc', entryType: 'CREDIT', amount: 15_000, categoryId: INVESTMENT_PROFIT_CATEGORY, note: 'August share' },
        ],
      }),
      'u1',
      expect.anything(),
    );
    expect(investment).toMatchObject({ profit: '15000.00', capital: '1000000.00' });
  });

  it('takes capital back into a wallet, records a loss with no money moving, and refuses more than is left', async () => {
    const { service, transactions } = setup();
    const made = await service.create('b1', form(), 'u1');
    await service.addEntry('b1', made.id, { type: 'BACK', amount: 400_000, date: '2026-01-01', accountId: 'cash' }, 'u1');
    expect(transactions.createTransaction).toHaveBeenLastCalledWith(
      'b1',
      expect.objectContaining({
        transactionType: 'JOURNAL',
        entries: [expect.objectContaining({ accountId: 'cash', entryType: 'DEBIT' }), expect.objectContaining({ accountId: 'pool', entryType: 'CREDIT' })],
      }),
      'u1',
      expect.anything(),
    );
    const calls = transactions.createTransaction.mock.calls.length;
    const { investment } = await service.addEntry('b1', made.id, { type: 'LOSS', amount: 100_000, date: '2026-02-01' }, 'u1');
    expect(transactions.createTransaction).toHaveBeenCalledTimes(calls);
    expect(investment.capital).toBe('500000.00');
    await expect(service.addEntry('b1', made.id, { type: 'BACK', amount: 500_000.01, date: '2026-03-01', accountId: 'cash' }, 'u1')).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.addEntry('b1', made.id, { type: 'PROFIT', amount: 10, date: '2025-06-30', accountId: 'cash' }, 'u1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('closes with less than the capital: the rest is a loss', async () => {
    const { service, entriesOf } = setup();
    const made = await service.create('b1', form({ amount: 150_000 }), 'u1');
    const closed = await service.close('b1', made.id, { amount: 120_000, date: '2026-01-10', accountId: 'cash' }, 'u1');
    expect(closed.closedAt).toEqual(day('2026-01-10'));
    expect(
      entriesOf()
        .filter((e) => e.fromClose)
        .map((e) => [e.type, Number(e.amount), e.accountId]),
    ).toEqual([
      ['BACK', 120_000, 'cash'],
      ['LOSS', 30_000, null],
    ]);
    expect(closed.capital).toBe('0.00');
    await expect(service.addEntry('b1', made.id, { type: 'PROFIT', amount: 1, date: '2026-01-11', accountId: 'cash' }, 'u1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('closes with more than the capital: the extra is profit; nothing back is all loss', async () => {
    const { service, entriesOf } = setup();
    const a = await service.create('b1', form({ amount: 150_000 }), 'u1');
    await service.close('b1', a.id, { amount: 182_000, date: '2026-01-10', accountId: 'cash' }, 'u1');
    expect(
      entriesOf()
        .filter((e) => e.fromClose)
        .map((e) => [e.type, Number(e.amount)]),
    ).toEqual([
      ['BACK', 150_000],
      ['PROFIT', 32_000],
    ]);
    const b = await service.create('b1', form({ amount: 50_000 }), 'u1');
    const closed = await service.close('b1', b.id, { amount: 0, date: '2026-01-10' }, 'u1');
    expect(closed.entries.filter((e: Row) => e.fromClose).map((e: Row) => [e.type, Number(e.amount), e.transactionId])).toEqual([['LOSS', 50_000, null]]);
  });

  it('undoes a close: its entries go, their postings voided, and the investment is open', async () => {
    const { service, postings } = setup();
    const made = await service.create('b1', form({ amount: 150_000 }), 'u1');
    await service.close('b1', made.id, { amount: 150_000, date: '2026-01-10', accountId: 'cash' }, 'u1');
    const open = await service.undoClose('b1', made.id, 'u1');
    expect(open).toMatchObject({ closedAt: null, capital: '150000.00' });
    expect(postings.filter((p) => p.status === 'VOIDED')).toHaveLength(1);
  });

  it('deletes an entry with its posting and brings both back on undo', async () => {
    const { service, postings, deletions } = setup();
    const made = await service.create('b1', form(), 'u1');
    const { entryId } = await service.addEntry('b1', made.id, { type: 'PROFIT', amount: 15_000, date: '2025-08-05', accountId: 'islami' }, 'u1');
    const after = await service.removeEntry('b1', made.id, entryId, 'u1');
    expect(after.profit).toBe('0.00');
    expect(postings.at(-1)).toMatchObject({ status: 'VOIDED', reason: INVESTMENT_ENTRY_DELETED_REASON });
    expect(deletions).toHaveLength(1);
    await expect(service.restoreEntry('b1', made.id, entryId, 'someone-else')).rejects.toThrow(ForbiddenException);
    const back = await service.restoreEntry('b1', made.id, entryId, 'u1');
    expect(back.profit).toBe('15000.00');
    expect(postings.at(-1)).toMatchObject({ status: 'POSTED' });
    // The first amount goes only with the investment.
    await expect(service.removeEntry('b1', made.id, back.entries[0].id, 'u1')).rejects.toThrow(BadRequestException);
  });

  it('refuses to delete a top-up that capital already taken back depends on', async () => {
    const { service } = setup();
    const made = await service.create('b1', form({ amount: 100_000 }), 'u1');
    const { entryId } = await service.addEntry('b1', made.id, { type: 'ADD', amount: 50_000, date: '2025-09-01', accountId: 'islami' }, 'u1');
    await service.addEntry('b1', made.id, { type: 'BACK', amount: 120_000, date: '2025-10-01', accountId: 'islami' }, 'u1');
    await expect(service.removeEntry('b1', made.id, entryId, 'u1')).rejects.toThrow(BadRequestException);
  });

  it('deletes an investment with every posting voided, and restores it with them standing again', async () => {
    const { service, postings } = setup();
    const made = await service.create('b1', form(), 'u1');
    await service.addEntry('b1', made.id, { type: 'PROFIT', amount: 15_000, date: '2025-08-05', accountId: 'islami' }, 'u1');
    await service.remove('b1', made.id, 'u1');
    expect(postings.map((p) => [p.status, p.reason])).toEqual([
      ['VOIDED', INVESTMENT_DELETED_REASON],
      ['VOIDED', INVESTMENT_DELETED_REASON],
    ]);
    const back = await service.restore('b1', made.id, 'u1');
    expect(back).toMatchObject({ capital: '1000000.00', profit: '15000.00' });
    expect(postings.every((p) => p.status === 'POSTED')).toBe(true);
  });

  it('edits the first amount: the old posting is voided and the new one posted', async () => {
    const { service, postings } = setup();
    const made = await service.create('b1', form({ amount: 100_000 }), 'u1');
    await service.addEntry('b1', made.id, { type: 'BACK', amount: 60_000, date: '2025-10-01', accountId: 'islami' }, 'u1');
    // Less than what came back already is refused.
    await expect(service.update('b1', made.id, form({ amount: 50_000 }), 'u1')).rejects.toThrow(BadRequestException);
    // A start after an entry is refused.
    await expect(service.update('b1', made.id, form({ startDate: '2025-11-01', firstDueDate: '2025-12-01' }), 'u1')).rejects.toThrow(BadRequestException);
    const edited = await service.update('b1', made.id, form({ amount: 120_000, sourceAccountId: 'cash' }), 'u1');
    expect(edited.capital).toBe('60000.00');
    expect(postings[0]).toMatchObject({ status: 'VOIDED' });
    expect(postings.at(-1)).toMatchObject({
      status: 'POSTED',
      entries: [expect.objectContaining({ accountId: 'pool', amount: 120_000 }), expect.objectContaining({ accountId: 'cash' })],
    });
  });
});
