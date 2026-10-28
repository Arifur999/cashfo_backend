import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ListTransactionsQueryDto } from '../transactions/dto/list-transactions-query.dto.js';
import { CHARGE_CATEGORY, TransactionsService } from '../transactions/transactions.service.js';
import { ReceivablesPayablesService } from './receivables-payables.service.js';

// Loans › New entry and Edit: a charge paid with an entry, and an entry
// corrected in place of the original.
const CONTACTS: Record<string, { id: string; businessId: string; name: string; type: string; category: string; openingBalance: Prisma.Decimal }> = {
  bank: { id: 'bank', businessId: 'biz-1', name: 'Islami Bank', type: 'BANK', category: 'LOAN', openingBalance: new Prisma.Decimal(0) },
  shop: { id: 'shop', businessId: 'biz-1', name: 'Shop', type: 'CUSTOMER', category: 'BUSINESS', openingBalance: new Prisma.Decimal(0) },
};

const recording = (original: object | null = null) => {
  const createTransaction = vi.fn((_businessId: string, dto: object) => Promise.resolve({ id: 'new-1', ...dto }));
  const postCharge = vi.fn().mockResolvedValue({ id: 'charge-1' });
  const voidTransaction = vi.fn().mockResolvedValue({});
  const tx = { transaction: { update: vi.fn().mockResolvedValue({}) } };
  const withLocks = vi.fn((_keys: string[], work: (client: typeof tx) => unknown) => work(tx));
  const prisma = {
    $transaction: vi.fn((work: (client: typeof tx) => unknown) => work(tx)),
    contact: { findUnique: vi.fn(({ where }: { where: { id: string } }) => Promise.resolve(CONTACTS[where.id] ?? null)) },
    account: {
      findFirst: vi.fn(({ where }: { where: { accountSubtype: string } }) =>
        Promise.resolve({ id: where.accountSubtype === 'receivable' ? 'ar' : 'ap', businessId: 'biz-1' }),
      ),
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === 'cash' ? { id: 'cash', businessId: 'biz-1', accountType: 'ASSET', accountSubtype: 'cash' } : null),
      ),
    },
    transaction: { findUnique: vi.fn().mockResolvedValue(original) },
  };
  const service = new ReceivablesPayablesService(prisma as never, { createTransaction, postCharge, voidTransaction, withLocks } as never);
  return { service, createTransaction, postCharge, voidTransaction, withLocks, tx };
};

const loan = { amount: 500000, date: '2026-01-01', moneyAccountId: 'cash', contactId: 'bank' };

describe('a loan entry with a charge', () => {
  it('posts the charge out of the same wallet, tied to the entry', async () => {
    const { service, postCharge, tx } = recording();
    await service.recordPurchase('biz-1', { ...loan, charge: 1000 } as never, 'user-1');
    expect(postCharge).toHaveBeenCalledWith(tx, 'biz-1', 'new-1', { amount: 1000, moneyAccountId: 'cash', date: '2026-01-01', contactId: 'bank' }, 'user-1');
  });

  it('posts no charge when none is sent', async () => {
    const { service, postCharge } = recording();
    await service.recordSale('biz-1', loan as never, 'user-1');
    expect(postCharge).not.toHaveBeenCalled();
  });

  it('refuses a charge on a trade sale, which moves no money', async () => {
    const { service } = recording();
    await expect(service.recordSale('biz-1', { amount: 400, date: '2026-01-01', contactId: 'shop', charge: 20 } as never, 'user-1')).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('editing a loan entry', () => {
  const payment = (subtype: string) => ({
    businessId: 'biz-1',
    transactionType: 'PAYMENT',
    contactId: 'bank',
    entries: [{ account: { accountSubtype: 'cash' } }, { account: { accountSubtype: subtype } }],
  });

  it('voids the original as Corrected, posts the new one and links them, under the contact lock', async () => {
    const { service, voidTransaction, createTransaction, withLocks, tx } = recording(payment('payable'));
    // The outstanding-balance check has its own specs.
    Object.assign(service, { validatePaymentAmount: vi.fn().mockResolvedValue(undefined) });
    const corrected = await service.correctPaidPayment('biz-1', 'old-1', { ...loan, amount: 5000 } as never, 'user-1');
    expect(withLocks.mock.calls[0][0]).toEqual(['contact:bank']);
    expect(voidTransaction).toHaveBeenCalledWith('biz-1', 'old-1', 'Corrected', 'user-1', tx);
    expect(createTransaction.mock.calls[0][1]).toMatchObject({ transactionType: 'PAYMENT', contactId: 'bank' });
    expect(tx.transaction.update).toHaveBeenCalledWith({ where: { id: 'new-1' }, data: { correctedFromId: 'old-1' } });
    expect(corrected).toMatchObject({ id: 'new-1', correctedFromId: 'old-1' });
  });

  it('keeps an entry the kind it was: money received is not corrected as money paid', async () => {
    const { service, voidTransaction } = recording(payment('receivable'));
    await expect(service.correctPaidPayment('biz-1', 'old-1', loan as never, 'user-1')).rejects.toThrow(BadRequestException);
    expect(voidTransaction).not.toHaveBeenCalled();
  });
});

describe('TransactionsService and charges', () => {
  it('voids an entry’s charge with it', async () => {
    const original = {
      id: 'loan-1',
      businessId: 'biz-1',
      status: 'POSTED',
      reversalOfId: null,
      transactionType: 'PAYMENT',
      description: null,
      referenceNo: null,
      contactId: 'bank',
      entries: [],
    };
    const tx = {
      transaction: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(original)
          .mockResolvedValueOnce({ ...original, id: 'charge-1', transactionType: 'EXPENSE', chargeForId: 'loan-1' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue({ id: 'reversal', entries: [] }),
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ id: 'charge-1' }])
          .mockResolvedValue([]),
      },
      savingsGoalEntry: { findFirst: vi.fn().mockResolvedValue(null) },
      asset: { findFirst: vi.fn().mockResolvedValue(null) },
      account: { count: vi.fn().mockResolvedValue(0) },
      $queryRaw: vi.fn().mockResolvedValue([]),
    };
    const prisma = { $transaction: vi.fn((work: (client: typeof tx) => unknown) => work(tx)) };
    const service = new TransactionsService(prisma as never, { recalculateBalance: vi.fn() } as never);
    await service.voidTransaction('biz-1', 'loan-1', 'Corrected', 'user-1');
    expect(tx.transaction.updateMany.mock.calls.map((call) => call[0].where.id)).toEqual(['loan-1', 'charge-1']);
    // The charge's reversal stays a charge, so lists without charges leave it out.
    expect(tx.transaction.create.mock.calls[1][0].data.chargeForId).toBe('loan-1');
  });

  it('files a charge under its category, out of the wallet', async () => {
    const tx = {
      account: { findFirst: vi.fn().mockResolvedValue({ id: 'general-expense' }) },
      transaction: { update: vi.fn().mockResolvedValue({}) },
    };
    const service = new TransactionsService({} as never, {} as never);
    const createTransaction = vi.spyOn(service, 'createTransaction').mockResolvedValue({ id: 'charge-1' } as never);
    await service.postCharge(tx as never, 'biz-1', 'loan-1', { amount: 50, moneyAccountId: 'cash', date: '2026-09-30', contactId: 'bank' }, 'user-1');
    expect(createTransaction.mock.calls[0][1]).toMatchObject({
      transactionType: 'EXPENSE',
      contactId: 'bank',
      entries: [
        { accountId: 'general-expense', entryType: 'DEBIT', amount: 50, categoryId: CHARGE_CATEGORY },
        { accountId: 'cash', entryType: 'CREDIT', amount: 50 },
      ],
    });
    expect(tx.transaction.update).toHaveBeenCalledWith({ where: { id: 'charge-1' }, data: { chargeForId: 'loan-1' } });
  });

  it('lists each entry with its charge and the contact’s balance just after it', async () => {
    const day = (date: string, minute: number) => ({ transactionDate: new Date(date), createdAt: new Date(`${date}T10:0${minute}:00Z`) });
    const rows = [
      { id: 'repay', contactId: 'bank', status: 'POSTED', reversalOfId: null, ...day('2026-03-01', 1), entries: [] },
      { id: 'loan', contactId: 'bank', status: 'POSTED', reversalOfId: null, ...day('2026-01-01', 1), entries: [] },
    ];
    const prisma = {
      transaction: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce(rows)
          .mockResolvedValueOnce([{ chargeForId: 'loan', entries: [{ amount: new Prisma.Decimal(1000) }] }]),
        count: vi.fn().mockResolvedValue(2),
      },
      savingsGoalEntry: { findMany: vi.fn().mockResolvedValue([]) },
      asset: { findMany: vi.fn().mockResolvedValue([]) },
      contact: { findMany: vi.fn().mockResolvedValue([{ id: 'bank', openingBalance: new Prisma.Decimal(0) }]) },
      transactionEntry: {
        findMany: vi.fn().mockResolvedValue([
          // Took 5,00,000 (Cr Payable), then paid 1,00,000 back (Dr Payable).
          { entryType: 'CREDIT', amount: new Prisma.Decimal(500000), transaction: { contactId: 'bank', ...day('2026-01-01', 1) } },
          { entryType: 'DEBIT', amount: new Prisma.Decimal(100000), transaction: { contactId: 'bank', ...day('2026-03-01', 1) } },
        ]),
      },
    };
    const service = new TransactionsService(prisma as never, {} as never);
    const { data } = await service.listTransactions('biz-1', { withLoanBalance: true, excludeCharges: true } as ListTransactionsQueryDto);
    expect(data.map((row) => [row.id, row.charge, row.loanBalanceAfter])).toEqual([
      ['repay', null, '-400000.00'],
      ['loan', '1000.00', '-500000.00'],
    ]);
    expect(prisma.transaction.findMany.mock.calls[0][0].where).toMatchObject({ chargeForId: null });
  });
});
