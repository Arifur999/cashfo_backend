import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { ListTransactionsQueryDto } from './dto/list-transactions-query.dto.js';
import { CORRECTED_REASON, DELETED_REASON, EDIT_UNDONE_REASON, RESTORE_WINDOW_MINUTES, TransactionsService } from './transactions.service.js';

const original = {
  id: 'tx-1',
  businessId: 'biz-1',
  status: 'POSTED',
  reversalOfId: null as string | null,
  transactionType: 'EXPENSE',
  description: 'Lunch',
  referenceNo: null,
  contactId: null,
  entries: [
    { accountId: 'cash', entryType: 'CREDIT', amount: '500', categoryId: 'Food', note: null },
    { accountId: 'food', entryType: 'DEBIT', amount: '500', categoryId: null, note: null },
  ],
};

const setup = ({
  transaction = original as typeof original | null,
  savingsEntry = null as object | null,
  asset = null as object | null,
  investmentEntry = null as object | null,
  referralAccounts = 0,
  claimed = 1,
} = {}) => {
  const tx = {
    transaction: {
      findUnique: vi.fn().mockResolvedValue(transaction),
      updateMany: vi.fn().mockResolvedValue({ count: claimed }),
      create: vi.fn().mockResolvedValue({ id: 'reversal-1', entries: [] }),
      // The charges paid with it (none unless a test says so).
      findMany: vi.fn().mockResolvedValue([]),
    },
    savingsGoalEntry: { findFirst: vi.fn().mockResolvedValue(savingsEntry) },
    zakatPayment: { findUnique: vi.fn().mockResolvedValue(null) },
    eventGift: { findUnique: vi.fn().mockResolvedValue(null) },
    investmentEntry: { findUnique: vi.fn().mockResolvedValue(investmentEntry) },
    asset: { findFirst: vi.fn().mockResolvedValue(asset) },
    account: { count: vi.fn().mockResolvedValue(referralAccounts) },
    $queryRaw: vi.fn().mockResolvedValue([]),
  };
  const prisma = { $transaction: vi.fn((work: (client: typeof tx) => unknown) => work(tx)) };
  const balances = { recalculateBalance: vi.fn().mockResolvedValue(undefined) };
  const service = new TransactionsService(prisma as never, balances as never);
  return { service, tx, balances };
};

describe('TransactionsService.voidTransaction', () => {
  it('voids a posted transaction with a mirrored reversal and recalculates both accounts', async () => {
    const { service, tx, balances } = setup();
    await expect(service.voidTransaction('biz-1', 'tx-1', 'entered twice', 'user-1')).resolves.toMatchObject({ original: { id: 'tx-1', status: 'VOIDED' } });
    expect(tx.transaction.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'tx-1', status: 'POSTED' } }));
    const reversal = tx.transaction.create.mock.calls[0][0].data;
    expect(reversal.reversalOfId).toBe('tx-1');
    expect(reversal.entries.create.map((e: { entryType: string }) => e.entryType)).toEqual(['DEBIT', 'CREDIT']);
    expect(balances.recalculateBalance).toHaveBeenCalledTimes(2);
  });

  it("is a 404 for another workspace's transaction", async () => {
    const { service } = setup({ transaction: { ...original, businessId: 'biz-2' } });
    await expect(service.voidTransaction('biz-1', 'tx-1', 'reason', 'user-1')).rejects.toThrow(NotFoundException);
  });

  it('refuses to void a reversal', async () => {
    const { service, tx } = setup({ transaction: { ...original, reversalOfId: 'tx-0' } });
    await expect(service.voidTransaction('biz-1', 'tx-1', 'reason', 'user-1')).rejects.toThrow(BadRequestException);
    expect(tx.transaction.create).not.toHaveBeenCalled();
  });

  it.each([
    ['a savings goal entry', { savingsEntry: { id: 'entry-1' } }],
    ['an asset purchase or sale', { asset: { id: 'asset-1' } }],
    ['a referral payout', { referralAccounts: 1 }],
    ['an investment entry', { investmentEntry: { id: 'entry-1' } }],
  ])('refuses to void a posting owned by %s', async (_label, options) => {
    const { service, tx } = setup(options);
    await expect(service.voidTransaction('biz-1', 'tx-1', 'reason', 'user-1')).rejects.toThrow(BadRequestException);
    expect(tx.transaction.updateMany).not.toHaveBeenCalled();
  });

  it('posts no second reversal when a parallel void already claimed it', async () => {
    const { service, tx } = setup({ claimed: 0 });
    await expect(service.voidTransaction('biz-1', 'tx-1', 'reason', 'user-1')).rejects.toThrow(BadRequestException);
    expect(tx.transaction.create).not.toHaveBeenCalled();
  });
});

describe("TransactionsService entries' accounts", () => {
  // A wallet the app names itself, and an account its owner named in Bangla.
  const cash = { id: 'cash', name: 'Cash', nameBn: null, accountType: 'ASSET', accountSubtype: 'cash' };
  const rent = { id: 'rent', name: 'Rent Expense', nameBn: 'ভাড়া খরচ', accountType: 'EXPENSE', accountSubtype: null };
  const posted = {
    ...original,
    entries: [
      { ...original.entries[0], account: cash },
      { ...original.entries[1], account: rent },
    ],
  };
  const accountSelect = { id: true, name: true, nameBn: true, accountType: true, accountSubtype: true };

  const reads = () => {
    const prisma = {
      transaction: {
        // The list's page; getTransaction() reads its corrections through it too.
        findMany: vi.fn().mockResolvedValue([posted]),
        findUnique: vi.fn().mockResolvedValue(posted),
        count: vi.fn().mockResolvedValue(1),
      },
      savingsGoalEntry: { findMany: vi.fn().mockResolvedValue([]) },
      zakatPayment: { findMany: vi.fn().mockResolvedValue([]) },
      eventGift: { findMany: vi.fn().mockResolvedValue([]) },
      investmentEntry: { findMany: vi.fn().mockResolvedValue([]) },
      asset: { findMany: vi.fn().mockResolvedValue([]) },
    };
    return { service: new TransactionsService(prisma as never, {} as never), prisma };
  };

  it("names each entry's account in Bangla too, on every row of the list", async () => {
    const { service, prisma } = reads();
    const { data } = await service.listTransactions('biz-1', {} as ListTransactionsQueryDto);
    expect(prisma.transaction.findMany.mock.calls[0][0].include.entries).toEqual({ include: { account: { select: accountSelect } } });
    expect(data[0].entries.map((entry) => entry.account.nameBn)).toEqual([null, 'ভাড়া খরচ']);
  });

  it('names them the same way on a single transaction', async () => {
    const { service, prisma } = reads();
    prisma.transaction.findMany.mockResolvedValue([]);
    const transaction = await service.getTransaction('biz-1', 'tx-1');
    expect(prisma.transaction.findUnique.mock.calls[0][0].include.entries).toEqual({ include: { account: { select: accountSelect } } });
    expect(transaction.entries.map((entry) => entry.account.nameBn)).toEqual([null, 'ভাড়া খরচ']);
  });
});

// A small in-memory stand-in for the transaction table, enough for the undo
// paths: rows by id, and the where-shapes they query with.
type Row = {
  id: string;
  businessId: string;
  status: string;
  reversalOfId: string | null;
  chargeForId: string | null;
  voidedAt: Date | null;
  voidedReason: string | null;
  deletedAt: Date | null;
  deletedById: string | null;
  createdBy: string;
  entries: { accountId: string }[];
};
type Where = Record<string, unknown>;

const matches = (row: Row, where: Where) =>
  Object.entries(where).every(([key, want]) => {
    const have = row[key as keyof Row];
    if (want && typeof want === 'object' && 'in' in want) return (want.in as unknown[]).includes(have);
    if (want instanceof Date) return have instanceof Date && have.getTime() === want.getTime();
    return have === want;
  });

const fakeLedger = (rows: Row[], { archived = 0, claimShortBy = 0 } = {}) => {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const tx = {
    transaction: {
      findUnique: vi.fn(({ where }: { where: { id: string } }): Promise<unknown> => Promise.resolve(byId.get(where.id) ?? null)),
      findFirst: vi.fn(({ where }: { where: Where }) => Promise.resolve(rows.find((r) => matches(r, where)) ?? null)),
      findMany: vi.fn(({ where }: { where: Where }) => Promise.resolve(rows.filter((r) => matches(r, where)))),
      updateMany: vi.fn(({ where }: { where: Where; data?: Record<string, unknown> }) =>
        Promise.resolve({ count: rows.filter((r) => matches(r, where)).length - claimShortBy }),
      ),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    transactionEntry: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
    account: { count: vi.fn().mockResolvedValue(archived) },
    $queryRaw: vi.fn().mockResolvedValue([]),
  };
  const prisma = { $transaction: vi.fn((work: (client: typeof tx) => unknown) => work(tx)) };
  const balances = { recalculateBalance: vi.fn().mockResolvedValue(undefined) };
  const service = new TransactionsService(prisma as never, balances as never);
  return { service, tx, balances };
};

const NOW = new Date('2026-11-03T10:00:00Z');
const DELETED_AT = new Date('2026-11-03T09:58:00Z');
const row = (over: Partial<Row>): Row => ({
  id: 'tx-1',
  businessId: 'biz-1',
  status: 'POSTED',
  reversalOfId: null,
  chargeForId: null,
  voidedAt: null,
  voidedReason: null,
  deletedAt: null,
  deletedById: null,
  createdBy: 'user-1',
  entries: [{ accountId: 'cash' }, { accountId: 'food' }],
  ...over,
});
const deletedRow = (over: Partial<Row> = {}) =>
  row({ status: 'VOIDED', voidedAt: DELETED_AT, voidedReason: DELETED_REASON, deletedAt: DELETED_AT, deletedById: 'user-1', ...over });
const reversalOf = (id: string) => row({ id: `rev-${id}`, reversalOfId: id });

describe('TransactionsService.deleteTransaction', () => {
  it('voids with DELETED_REASON and records who deleted it and when, on the entry and its charges alike', async () => {
    const { service, tx } = setup();
    tx.transaction.findMany.mockResolvedValueOnce([{ id: 'charge-1' }]).mockResolvedValue([]);
    tx.transaction.findUnique.mockResolvedValueOnce(original).mockResolvedValueOnce({ ...original, id: 'charge-1' });
    await service.deleteTransaction('biz-1', 'tx-1', 'user-1');
    const [entry, charge] = tx.transaction.updateMany.mock.calls.map((c) => c[0].data);
    expect(entry).toMatchObject({ status: 'VOIDED', voidedReason: DELETED_REASON, deletedById: 'user-1' });
    expect(entry.deletedAt).toBe(entry.voidedAt);
    // One moment for the whole delete, so an undo knows which charges it took.
    expect(charge.voidedAt).toBe(entry.voidedAt);
    expect(charge.deletedById).toBe('user-1');
  });

  it('leaves a plain void without a delete record, so it can never be undone', async () => {
    const { service, tx } = setup();
    await service.voidTransaction('biz-1', 'tx-1', DELETED_REASON, 'user-1');
    expect(tx.transaction.updateMany.mock.calls[0][0].data).not.toHaveProperty('deletedAt');
  });
});

describe('TransactionsService.restoreTransaction', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stands the transaction again, records who brought it back, drops its reversal and recalculates each account once', async () => {
    const { service, tx, balances } = fakeLedger([deletedRow(), reversalOf('tx-1')]);
    await expect(service.restoreTransaction('biz-1', 'tx-1', 'user-1')).resolves.toEqual({ id: 'tx-1', status: 'POSTED' });
    expect(tx.transaction.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['tx-1'] }, status: 'VOIDED', voidedAt: DELETED_AT },
      data: { status: 'POSTED', voidedAt: null, voidedReason: null, restoredAt: NOW, restoredById: 'user-1' },
    });
    expect(tx.transactionEntry.deleteMany).toHaveBeenCalledWith({ where: { transactionId: { in: ['rev-tx-1'] } } });
    expect(tx.transaction.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['rev-tx-1'] } } });
    expect(balances.recalculateBalance).toHaveBeenCalledTimes(2);
  });

  it('brings back the charges this delete took, locking and recalculating every account once', async () => {
    const charge = deletedRow({ id: 'charge-1', chargeForId: 'tx-1', entries: [{ accountId: 'fees' }, { accountId: 'cash' }] });
    const { service, tx, balances } = fakeLedger([deletedRow(), charge, reversalOf('tx-1'), reversalOf('charge-1')]);
    await service.restoreTransaction('biz-1', 'tx-1', 'user-1');
    expect(tx.transaction.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.transaction.updateMany.mock.calls[0][0].where.id).toEqual({ in: ['tx-1', 'charge-1'] });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(balances.recalculateBalance.mock.calls.map((c) => c[0]).sort()).toEqual(['cash', 'fees', 'food']);
  });

  it('leaves a charge deleted on its own earlier deleted, and still brings the entry back', async () => {
    // Deleted by someone else, long ago: neither the window nor the person may stop the entry's undo.
    const old = new Date('2026-11-03T09:00:00Z');
    const charge = deletedRow({ id: 'charge-1', chargeForId: 'tx-1', voidedAt: old, deletedAt: old, deletedById: 'user-2' });
    const { service, tx } = fakeLedger([deletedRow(), charge, reversalOf('tx-1'), reversalOf('charge-1')]);
    await expect(service.restoreTransaction('biz-1', 'tx-1', 'user-1')).resolves.toEqual({ id: 'tx-1', status: 'POSTED' });
    expect(tx.transaction.updateMany.mock.calls[0][0].where.id).toEqual({ in: ['tx-1'] });
  });

  it.each([
    ['a void with the same words that no delete made', deletedRow({ deletedAt: null, deletedById: null })],
    ['an entry voided again (an edit) after an undone delete', deletedRow({ voidedAt: new Date('2026-11-03T09:59:00Z'), voidedReason: 'Corrected' })],
    ['a transaction that stands', deletedRow({ status: 'POSTED', voidedAt: null })],
    ['a reversal', deletedRow({ reversalOfId: 'tx-0' })],
    ['a delete older than the window', deletedRow({ voidedAt: new Date('2026-11-03T09:49:00Z'), deletedAt: new Date('2026-11-03T09:49:00Z') })],
  ])('refuses %s', async (_label, transaction) => {
    const { service, tx } = fakeLedger([transaction, reversalOf('tx-1')]);
    await expect(service.restoreTransaction('biz-1', 'tx-1', 'user-1')).rejects.toThrow(BadRequestException);
    expect(tx.transaction.updateMany).not.toHaveBeenCalled();
  });

  it('names the window from RESTORE_WINDOW_MINUTES', async () => {
    const late = new Date(NOW.getTime() - (RESTORE_WINDOW_MINUTES + 1) * 60_000);
    const { service } = fakeLedger([deletedRow({ voidedAt: late, deletedAt: late }), reversalOf('tx-1')]);
    await expect(service.restoreTransaction('biz-1', 'tx-1', 'user-1')).rejects.toThrow(`for ${RESTORE_WINDOW_MINUTES} minutes only`);
  });

  it("is a 404 for another workspace's transaction", async () => {
    const { service } = fakeLedger([deletedRow({ businessId: 'biz-2' })]);
    await expect(service.restoreTransaction('biz-1', 'tx-1', 'user-1')).rejects.toThrow(NotFoundException);
  });

  it('lets only the person who deleted it undo it', async () => {
    const { service, tx } = fakeLedger([deletedRow({ deletedById: 'user-2' }), reversalOf('tx-1')]);
    await expect(service.restoreTransaction('biz-1', 'tx-1', 'user-1')).rejects.toThrow(ForbiddenException);
    expect(tx.transaction.updateMany).not.toHaveBeenCalled();
  });

  it('keeps a charge deleted while the entry it was paid with stays deleted', async () => {
    const { service, tx } = fakeLedger([deletedRow({ chargeForId: 'loan-1' }), deletedRow({ id: 'loan-1' }), reversalOf('tx-1')]);
    await expect(service.restoreTransaction('biz-1', 'tx-1', 'user-1')).rejects.toThrow('Bring back the entry this charge was paid with first');
    expect(tx.transaction.updateMany).not.toHaveBeenCalled();
  });

  it('puts no money back into an archived wallet', async () => {
    const { service, tx } = fakeLedger([deletedRow(), reversalOf('tx-1')], { archived: 1 });
    await expect(service.restoreTransaction('biz-1', 'tx-1', 'user-1')).rejects.toThrow('has been archived');
    expect(tx.transaction.updateMany).not.toHaveBeenCalled();
  });

  it('deletes no reversal when a parallel undo already claimed it', async () => {
    const { service, tx } = fakeLedger([deletedRow(), reversalOf('tx-1')], { claimShortBy: 1 });
    await expect(service.restoreTransaction('biz-1', 'tx-1', 'user-1')).rejects.toThrow('This transaction is back already');
    expect(tx.transaction.deleteMany).not.toHaveBeenCalled();
  });
});

describe('TransactionsService.linkCorrection', () => {
  it('frees the original from an undone edit, then links the new edit to it', async () => {
    const service = new TransactionsService({} as never, { recalculateBalance: vi.fn() } as never);
    const tx = { transaction: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), update: vi.fn().mockResolvedValue({}) } };
    await service.linkCorrection(tx as never, 'tx-3', 'tx-1');
    expect(tx.transaction.updateMany).toHaveBeenCalledWith({ where: { correctedFromId: 'tx-1', status: 'VOIDED' }, data: { correctedFromId: null } });
    expect(tx.transaction.update).toHaveBeenCalledWith({ where: { id: 'tx-3' }, data: { correctedFromId: 'tx-1' } });
    expect(tx.transaction.updateMany.mock.invocationCallOrder[0]).toBeLessThan(tx.transaction.update.mock.invocationCallOrder[0]);
  });
});

describe('TransactionsService.undoCorrection', () => {
  const corrected = {
    businessId: 'biz-1',
    status: 'POSTED',
    reversalOfId: null as string | null,
    correctedFromId: 'tx-1' as string | null,
    createdBy: 'user-1',
    createdAt: new Date('2026-11-03T09:57:00Z'),
  };
  const replaced = row({ status: 'VOIDED', voidedAt: new Date('2026-11-03T09:57:00Z'), voidedReason: CORRECTED_REASON });

  const undoSetup = (transaction: typeof corrected | null = corrected, original: Row = replaced) => {
    const ledger = fakeLedger([original, reversalOf('tx-1')]);
    ledger.tx.transaction.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve(where.id === 'tx-2' ? transaction : where.id === 'tx-1' ? original : null),
    );
    // The void is tested above; here only what undo asks of it.
    const voidIn = vi.spyOn(ledger.service as unknown as { voidIn: () => Promise<unknown> }, 'voidIn').mockResolvedValue(undefined);
    return { ...ledger, voidIn };
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('voids the edited entry and stands the original again, in one transaction', async () => {
    const { service, tx, voidIn } = undoSetup();
    await expect(service.undoCorrection('biz-1', 'tx-2', 'user-1')).resolves.toEqual({ id: 'tx-1', status: 'POSTED' });
    expect(voidIn).toHaveBeenCalledWith(tx, 'biz-1', 'tx-2', EDIT_UNDONE_REASON, 'user-1');
    expect(tx.transaction.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'POSTED', restoredById: 'user-1' });
    expect(voidIn.mock.invocationCallOrder[0]).toBeLessThan(tx.transaction.updateMany.mock.invocationCallOrder[0]);
  });

  it.each([
    ['an entry no edit made', { ...corrected, correctedFromId: null }],
    ['an edit already replaced or deleted', { ...corrected, status: 'VOIDED' }],
    ['a reversal', { ...corrected, reversalOfId: 'tx-0' }],
    ['an edit older than the window', { ...corrected, createdAt: new Date('2026-11-03T09:49:00Z') }],
  ])('refuses %s', async (_label, transaction) => {
    const { service, voidIn } = undoSetup(transaction);
    await expect(service.undoCorrection('biz-1', 'tx-2', 'user-1')).rejects.toThrow(BadRequestException);
    expect(voidIn).not.toHaveBeenCalled();
  });

  it('voids nothing when the original is no longer the one the edit replaced', async () => {
    const { service, voidIn } = undoSetup(corrected, { ...replaced, status: 'POSTED', voidedReason: null });
    await expect(service.undoCorrection('biz-1', 'tx-2', 'user-1')).rejects.toThrow(BadRequestException);
    expect(voidIn).not.toHaveBeenCalled();
  });

  it('lets only the person who made the edit undo it', async () => {
    const { service, voidIn } = undoSetup({ ...corrected, createdBy: 'user-2' });
    await expect(service.undoCorrection('biz-1', 'tx-2', 'user-1')).rejects.toThrow(ForbiddenException);
    expect(voidIn).not.toHaveBeenCalled();
  });

  it("is a 404 for another workspace's entry", async () => {
    const { service } = undoSetup({ ...corrected, businessId: 'biz-2' });
    await expect(service.undoCorrection('biz-1', 'tx-2', 'user-1')).rejects.toThrow(NotFoundException);
  });
});
