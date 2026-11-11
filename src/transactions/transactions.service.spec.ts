import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { ListTransactionsQueryDto } from './dto/list-transactions-query.dto.js';
import { CORRECTED_REASON, DELETED_REASON, EDIT_UNDONE_REASON, TransactionsService } from './transactions.service.js';

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

describe('TransactionsService.restoreTransaction', () => {
  const NOW = new Date('2026-11-03T10:00:00Z');
  const deleted = {
    ...original,
    status: 'VOIDED',
    voidedReason: DELETED_REASON,
    voidedAt: new Date('2026-11-03T09:58:00Z'),
    chargeForId: null as string | null,
  };

  const restoreSetup = ({
    transaction = deleted as typeof deleted | null,
    reversal = { id: 'reversal-1', createdBy: 'user-1' } as object | null,
    claimed = 1,
    charges = [] as { id: string }[],
    paidWith = null as object | null,
  } = {}) => {
    const tx = {
      transaction: {
        // The entry a charge was paid with is read with a select; it stands
        // (the mock doesn't see the claim) unless a test says otherwise.
        findUnique: vi
          .fn()
          .mockImplementation(({ where, select }: { where: { id: string }; select?: object }) =>
            Promise.resolve(
              select ? (paidWith ?? { status: 'POSTED' }) : where.id === 'charge-1' ? { ...deleted, id: 'charge-1', chargeForId: 'tx-1' } : transaction,
            ),
          ),
        findFirst: vi.fn().mockResolvedValue(reversal),
        updateMany: vi.fn().mockResolvedValue({ count: claimed }),
        delete: vi.fn().mockResolvedValue({}),
        findMany: vi.fn().mockResolvedValueOnce(charges).mockResolvedValue([]),
      },
      transactionEntry: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
      $queryRaw: vi.fn().mockResolvedValue([]),
    };
    const prisma = { $transaction: vi.fn((work: (client: typeof tx) => unknown) => work(tx)) };
    const balances = { recalculateBalance: vi.fn().mockResolvedValue(undefined) };
    const service = new TransactionsService(prisma as never, balances as never);
    return { service, tx, balances };
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stands the transaction again, drops its reversal and recalculates both accounts', async () => {
    const { service, tx, balances } = restoreSetup();
    await expect(service.restoreTransaction('biz-1', 'tx-1', 'user-1')).resolves.toEqual({ id: 'tx-1', status: 'POSTED' });
    expect(tx.transaction.updateMany).toHaveBeenCalledWith({
      where: { id: 'tx-1', status: 'VOIDED', voidedReason: DELETED_REASON },
      data: { status: 'POSTED', voidedAt: null, voidedReason: null },
    });
    expect(tx.transactionEntry.deleteMany).toHaveBeenCalledWith({ where: { transactionId: 'reversal-1' } });
    expect(tx.transaction.delete).toHaveBeenCalledWith({ where: { id: 'reversal-1' } });
    expect(balances.recalculateBalance).toHaveBeenCalledTimes(2);
  });

  it('brings back the charges deleted with it', async () => {
    const { service, tx } = restoreSetup({ charges: [{ id: 'charge-1' }] });
    await service.restoreTransaction('biz-1', 'tx-1', 'user-1');
    expect(tx.transaction.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.transaction.updateMany.mock.calls[1][0].where.id).toBe('charge-1');
  });

  it.each([
    ['a correction', { ...deleted, voidedReason: 'Corrected' }],
    ["a feature's own void", { ...deleted, voidedReason: 'Asset deleted: Fridge' }],
    ['a transaction that stands', { ...deleted, status: 'POSTED', voidedReason: null }],
    ['a reversal', { ...deleted, reversalOfId: 'tx-0' }],
    ['a delete older than the window', { ...deleted, voidedAt: new Date('2026-11-03T09:49:00Z') }],
  ])('refuses %s', async (_label, transaction) => {
    const { service, tx } = restoreSetup({ transaction: transaction as typeof deleted });
    await expect(service.restoreTransaction('biz-1', 'tx-1', 'user-1')).rejects.toThrow(BadRequestException);
    expect(tx.transaction.updateMany).not.toHaveBeenCalled();
  });

  it("is a 404 for another workspace's transaction", async () => {
    const { service } = restoreSetup({ transaction: { ...deleted, businessId: 'biz-2' } });
    await expect(service.restoreTransaction('biz-1', 'tx-1', 'user-1')).rejects.toThrow(NotFoundException);
  });

  it('lets only the person who deleted it undo it', async () => {
    const { service, tx } = restoreSetup({ reversal: { id: 'reversal-1', createdBy: 'user-2' } });
    await expect(service.restoreTransaction('biz-1', 'tx-1', 'user-1')).rejects.toThrow(ForbiddenException);
    expect(tx.transaction.updateMany).not.toHaveBeenCalled();
  });

  it('keeps a charge deleted while the entry it was paid with stays deleted', async () => {
    const { service, tx } = restoreSetup({ transaction: { ...deleted, chargeForId: 'transfer-1' }, paidWith: { status: 'VOIDED' } });
    await expect(service.restoreTransaction('biz-1', 'tx-1', 'user-1')).rejects.toThrow(BadRequestException);
    expect(tx.transaction.updateMany).not.toHaveBeenCalled();
  });

  it('deletes no reversal when a parallel undo already claimed it', async () => {
    const { service, tx } = restoreSetup({ claimed: 0 });
    await expect(service.restoreTransaction('biz-1', 'tx-1', 'user-1')).rejects.toThrow(BadRequestException);
    expect(tx.transaction.delete).not.toHaveBeenCalled();
  });
});

describe('TransactionsService.undoCorrection', () => {
  const NOW = new Date('2026-11-03T10:00:00Z');
  const corrected = {
    businessId: 'biz-1',
    status: 'POSTED',
    reversalOfId: null as string | null,
    correctedFromId: 'tx-1' as string | null,
    createdBy: 'user-1',
    createdAt: new Date('2026-11-03T09:57:00Z'),
  };

  const undoSetup = (transaction: typeof corrected | null = corrected) => {
    const tx = { transaction: { findUnique: vi.fn().mockResolvedValue(transaction) } };
    const prisma = { $transaction: vi.fn((work: (client: typeof tx) => unknown) => work(tx)) };
    const service = new TransactionsService(prisma as never, { recalculateBalance: vi.fn() } as never);
    // The void and the restore are tested above; here only what undo asks of them.
    const inner = service as unknown as { voidIn: () => Promise<unknown>; restoreIn: () => Promise<unknown> };
    const voidIn = vi.spyOn(inner, 'voidIn').mockResolvedValue(undefined);
    const restoreIn = vi.spyOn(inner, 'restoreIn').mockResolvedValue({ id: 'tx-1', status: 'POSTED' });
    return { service, tx, voidIn, restoreIn };
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('voids the edited entry and stands the original again, in one transaction', async () => {
    const { service, tx, voidIn, restoreIn } = undoSetup();
    await expect(service.undoCorrection('biz-1', 'tx-2', 'user-1')).resolves.toEqual({ id: 'tx-1', status: 'POSTED' });
    expect(voidIn).toHaveBeenCalledWith(tx, 'biz-1', 'tx-2', EDIT_UNDONE_REASON, 'user-1');
    expect(restoreIn).toHaveBeenCalledWith(tx, 'biz-1', 'tx-1', 'user-1', NOW, CORRECTED_REASON);
    expect(voidIn.mock.invocationCallOrder[0]).toBeLessThan(restoreIn.mock.invocationCallOrder[0]);
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
