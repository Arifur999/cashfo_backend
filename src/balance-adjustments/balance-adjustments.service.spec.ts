import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { adjustmentEntries, BalanceAdjustmentsService, DEFAULT_ADJUSTMENT_NOTE } from './balance-adjustments.service.js';

describe('adjustmentEntries', () => {
  it('brings money in when the real balance is higher, out when it is lower', () => {
    expect(adjustmentEntries('cash', 'equity', 1250)).toEqual([
      { accountId: 'cash', entryType: 'DEBIT', amount: 12.5 },
      { accountId: 'equity', entryType: 'CREDIT', amount: 12.5 },
    ]);
    expect(adjustmentEntries('cash', 'equity', -50000)).toEqual([
      { accountId: 'cash', entryType: 'CREDIT', amount: 500 },
      { accountId: 'equity', entryType: 'DEBIT', amount: 500 },
    ]);
  });
});

describe('BalanceAdjustmentsService.adjust', () => {
  const setup = (wallet: { id: string; status: string } | null, balance = '1200.00', equity: { id: string } | null = { id: 'equity' }) => {
    const tx = {
      account: {
        findFirst: vi.fn().mockResolvedValueOnce(wallet).mockResolvedValueOnce(equity),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ currentBalance: new Prisma.Decimal(balance) }),
        create: vi.fn().mockResolvedValue({ id: 'new-equity' }),
      },
      $queryRaw: vi.fn().mockResolvedValue([]),
      $executeRaw: vi.fn().mockResolvedValue(1),
    };
    const prisma = { $transaction: vi.fn((work: (client: typeof tx) => unknown) => work(tx)) };
    const transactions = { createTransaction: vi.fn().mockResolvedValue({ id: 'adj-1' }) };
    return { service: new BalanceAdjustmentsService(prisma as never, transactions as never), tx, transactions };
  };

  it('posts the difference against the adjustments account, as of the locked balance', async () => {
    const { service, tx, transactions } = setup({ id: 'cash', status: 'ACTIVE' });
    const result = await service.adjust('biz', 'cash', { realBalance: 1000 }, 'user');
    expect(result).toEqual({ adjusted: true, difference: '-200.00', transactionId: 'adj-1' });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const [business, dto, user, client] = transactions.createTransaction.mock.calls[0];
    expect([business, user, client]).toEqual(['biz', 'user', tx]);
    expect(dto).toMatchObject({ transactionType: 'JOURNAL', description: DEFAULT_ADJUSTMENT_NOTE });
    expect(dto.entries).toEqual(adjustmentEntries('cash', 'equity', -20000));
  });

  it('keeps the note and makes the adjustments account the first time', async () => {
    const { service, tx, transactions } = setup({ id: 'cash', status: 'ACTIVE' }, '50.00', null);
    await service.adjust('biz', 'cash', { realBalance: 80.25, note: 'SMS fees' }, 'user');
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.account.create.mock.calls[0][0].data).toMatchObject({ accountType: 'EQUITY', accountSubtype: 'balance-adjustment', isSystemAccount: true });
    expect(transactions.createTransaction.mock.calls[0][1]).toMatchObject({ description: 'SMS fees' });
    expect(transactions.createTransaction.mock.calls[0][1].entries[0]).toEqual({ accountId: 'cash', entryType: 'DEBIT', amount: 30.25 });
  });

  it('posts nothing when the balances already match', async () => {
    const { service, transactions } = setup({ id: 'cash', status: 'ACTIVE' }, '1000.00');
    expect(await service.adjust('biz', 'cash', { realBalance: 1000 }, 'user')).toEqual({ adjusted: false, difference: '0.00', transactionId: null });
    expect(transactions.createTransaction).not.toHaveBeenCalled();
  });

  it('refuses an archived wallet and one that is not a money account here', async () => {
    await expect(setup({ id: 'cash', status: 'ARCHIVED' }).service.adjust('biz', 'cash', { realBalance: 1 }, 'user')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(setup(null).service.adjust('biz', 'other', { realBalance: 1 }, 'user')).rejects.toBeInstanceOf(NotFoundException);
  });
});
