import { BadRequestException, NotFoundException } from '@nestjs/common';
import { QuickEntriesService } from './quick-entries.service.js';

const accounts: Record<string, { id: string; businessId: string; accountType: string; accountSubtype: string | null }> = {
  cash: { id: 'cash', businessId: 'biz-1', accountType: 'ASSET', accountSubtype: 'cash' },
  bank: { id: 'bank', businessId: 'biz-1', accountType: 'ASSET', accountSubtype: 'bank' },
  food: { id: 'food', businessId: 'biz-1', accountType: 'EXPENSE', accountSubtype: null },
};

const setup = ({ original = { businessId: 'biz-1', transactionType: 'EXPENSE' } as { businessId: string; transactionType: string } | null } = {}) => {
  const tx = { transaction: { findUnique: vi.fn().mockResolvedValue(original), update: vi.fn().mockResolvedValue({}) } };
  const prisma = {
    $transaction: vi.fn((work: (client: typeof tx) => unknown) => work(tx)),
    account: { findUnique: vi.fn(({ where }: { where: { id: string } }) => Promise.resolve(accounts[where.id] ?? null)) },
  };
  const transactions = {
    voidTransaction: vi.fn().mockResolvedValue({ original: { id: 'tx-1', status: 'VOIDED' } }),
    createTransaction: vi.fn().mockResolvedValue({ id: 'tx-2' }),
  };
  const service = new QuickEntriesService(prisma as never, transactions as never);
  return { service, tx, transactions };
};

const expense = { fromAccountId: 'cash', expenseAccountId: 'food', amount: 2540, date: '2026-09-30' };

describe('QuickEntriesService corrections', () => {
  it('voids the original as Corrected and posts the corrected entry in the same transaction', async () => {
    const { service, tx, transactions } = setup();
    await expect(service.correctExpense('biz-1', 'tx-1', expense, 'user-1')).resolves.toEqual({ id: 'tx-2', correctedFromId: 'tx-1' });
    expect(transactions.voidTransaction).toHaveBeenCalledWith('biz-1', 'tx-1', 'Corrected', 'user-1', tx);
    const [businessId, dto, userId, client] = transactions.createTransaction.mock.calls[0];
    expect([businessId, userId, client]).toEqual(['biz-1', 'user-1', tx]);
    expect(dto).toMatchObject({ transactionType: 'EXPENSE', transactionDate: '2026-09-30' });
    expect(transactions.voidTransaction.mock.invocationCallOrder[0]).toBeLessThan(transactions.createTransaction.mock.invocationCallOrder[0]);
    // The corrected entry points back at the original.
    expect(tx.transaction.update).toHaveBeenCalledWith({ where: { id: 'tx-2' }, data: { correctedFromId: 'tx-1' } });
  });

  it('keeps an entry the kind it was', async () => {
    const { service, transactions } = setup({ original: { businessId: 'biz-1', transactionType: 'INCOME' } });
    await expect(service.correctExpense('biz-1', 'tx-1', expense, 'user-1')).rejects.toThrow(BadRequestException);
    expect(transactions.voidTransaction).not.toHaveBeenCalled();
    expect(transactions.createTransaction).not.toHaveBeenCalled();
  });

  it("is a 404 for another workspace's entry", async () => {
    const { service, transactions } = setup({ original: { businessId: 'biz-2', transactionType: 'EXPENSE' } });
    await expect(service.correctExpense('biz-1', 'tx-1', expense, 'user-1')).rejects.toThrow(NotFoundException);
    expect(transactions.voidTransaction).not.toHaveBeenCalled();
  });

  it('posts nothing when the void is refused', async () => {
    const { service, transactions } = setup();
    transactions.voidTransaction.mockRejectedValueOnce(new BadRequestException('This transaction has already been voided'));
    await expect(service.correctExpense('biz-1', 'tx-1', expense, 'user-1')).rejects.toThrow('already been voided');
    expect(transactions.createTransaction).not.toHaveBeenCalled();
  });

  it('corrects a transfer between two wallets', async () => {
    const { service, transactions } = setup({ original: { businessId: 'biz-1', transactionType: 'TRANSFER' } });
    await service.correctTransfer('biz-1', 'tx-1', { fromAccountId: 'bank', toAccountId: 'cash', amount: 2000, date: '2026-10-17' }, 'user-1');
    expect(transactions.createTransaction.mock.calls[0][1]).toMatchObject({ transactionType: 'TRANSFER' });
  });
});
