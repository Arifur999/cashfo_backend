import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ListTransactionsQueryDto } from './dto/list-transactions-query.dto.js';
import { TransactionsService } from './transactions.service.js';

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

const setup = ({ transaction = original as typeof original | null, savingsEntry = null as object | null, asset = null as object | null, referralAccounts = 0, claimed = 1 } = {}) => {
  const tx = {
    transaction: {
      findUnique: vi.fn().mockResolvedValue(transaction),
      updateMany: vi.fn().mockResolvedValue({ count: claimed }),
      create: vi.fn().mockResolvedValue({ id: 'reversal-1', entries: [] }),
    },
    savingsGoalEntry: { findFirst: vi.fn().mockResolvedValue(savingsEntry) },
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
