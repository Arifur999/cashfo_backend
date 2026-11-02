import { ledgerKind, ledgerRowMatches, type LedgerKindInput } from './ledger-kind.js';

const base: LedgerKindInput = {
  transactionType: 'INCOME',
  direction: 'in',
  accountSubtype: 'cash',
  legs: [{ accountName: 'Salary Income', accountSubtype: null, categoryId: 'Salary' }],
  contact: null,
  asset: null,
  goalName: null,
  adjustmentSubtype: 'balance-adjustment',
};
const kind = (patch: Partial<LedgerKindInput>) => ledgerKind({ ...base, ...patch });

describe('ledgerKind', () => {
  it('names income and expense by their category', () => {
    expect(kind({})).toEqual({ kind: 'INCOME', party: 'Salary' });
    expect(
      kind({ transactionType: 'EXPENSE', direction: 'out', legs: [{ accountName: 'General Expense', accountSubtype: null, categoryId: 'Food & Dining' }] }),
    ).toEqual({ kind: 'EXPENSE', party: 'Food & Dining' });
    // No category: the account on the other side.
    expect(kind({ legs: [{ accountName: 'Freelance Income', accountSubtype: null, categoryId: null }] })).toEqual({
      kind: 'INCOME',
      party: 'Freelance Income',
    });
  });

  it('tells a transfer from a savings goal move, from either wallet', () => {
    const bank = [{ accountName: 'Islami Bank', accountSubtype: 'bank', categoryId: null }];
    const dps = [{ accountName: 'Islami DPS', accountSubtype: 'savings', categoryId: null }];
    expect(kind({ transactionType: 'TRANSFER', direction: 'out', legs: bank })).toEqual({ kind: 'TRANSFER', party: 'Islami Bank' });
    expect(kind({ transactionType: 'TRANSFER', direction: 'out', legs: dps, goalName: 'Emergency fund' })).toEqual({
      kind: 'SAVINGS',
      party: 'Emergency fund',
    });
    expect(kind({ transactionType: 'TRANSFER', direction: 'in', legs: dps })).toEqual({ kind: 'SAVINGS_WITHDRAW', party: 'Islami DPS' });
    // The savings wallet's own ledger: money coming in is saved.
    expect(kind({ transactionType: 'TRANSFER', direction: 'in', accountSubtype: 'savings', legs: bank })).toMatchObject({ kind: 'SAVINGS' });
    expect(kind({ transactionType: 'TRANSFER', direction: 'out', accountSubtype: 'savings', legs: bank })).toMatchObject({ kind: 'SAVINGS_WITHDRAW' });
  });

  it('names a loan or a payment by the person', () => {
    const receivable = [{ accountName: 'Accounts Receivable', accountSubtype: 'receivable', categoryId: null }];
    const loan = { name: 'Rahim', category: 'LOAN' as const };
    expect(kind({ transactionType: 'JOURNAL', direction: 'out', legs: receivable, contact: loan })).toEqual({ kind: 'LOAN_OUT', party: 'Rahim' });
    expect(kind({ transactionType: 'PAYMENT', direction: 'in', legs: receivable, contact: loan })).toEqual({ kind: 'LOAN_IN', party: 'Rahim' });
    expect(kind({ transactionType: 'PAYMENT', direction: 'in', legs: receivable, contact: { name: 'Karim Traders', category: 'BUSINESS' } })).toEqual({
      kind: 'PAYMENT_IN',
      party: 'Karim Traders',
    });
    // A contact on an income without the receivable is still income.
    expect(kind({ contact: loan })).toMatchObject({ kind: 'INCOME' });
  });

  it('puts an asset and an adjustment before everything else', () => {
    expect(kind({ transactionType: 'PURCHASE', direction: 'out', asset: { name: 'Gold ring', side: 'PURCHASE' } })).toEqual({
      kind: 'ASSET_PURCHASE',
      party: 'Gold ring',
    });
    expect(kind({ transactionType: 'SALE', asset: { name: 'Old fridge', side: 'SALE' } })).toEqual({ kind: 'ASSET_SALE', party: 'Old fridge' });
    expect(
      kind({ transactionType: 'JOURNAL', legs: [{ accountName: 'Balance adjustments', accountSubtype: 'balance-adjustment', categoryId: null }] }),
    ).toEqual({ kind: 'ADJUSTMENT', party: null });
  });

  it('calls anything else Other, naming its accounts', () => {
    expect(kind({ transactionType: 'JOURNAL', legs: [{ accountName: 'Owner equity', accountSubtype: null, categoryId: null }] })).toEqual({
      kind: 'OTHER',
      party: 'Owner equity',
    });
  });
});

describe('ledgerRowMatches', () => {
  const row = { description: 'Weekly groceries', referenceNo: 'MEMO-118', party: 'Food, drinks', chargeFor: null, amount: '2450.00' };

  it('finds the words in any case, commas included', () => {
    expect(ledgerRowMatches(row, 'GROCER')).toBe(true);
    expect(ledgerRowMatches(row, 'memo-1')).toBe(true);
    expect(ledgerRowMatches(row, 'food, dr')).toBe(true);
    expect(ledgerRowMatches(row, 'rent')).toBe(false);
  });

  it('finds the amount with or without its grouping', () => {
    expect(ledgerRowMatches(row, '2,450')).toBe(true);
    expect(ledgerRowMatches(row, '2450.00')).toBe(true);
    expect(ledgerRowMatches(row, '450')).toBe(false);
    expect(ledgerRowMatches(row, '')).toBe(true);
  });
});
