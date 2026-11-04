import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { loanStatementRows, type LoanStatementItem, type LoanStatementPosting } from './loan-statement.js';

const posting = (id: string, day: number, overrides: Partial<LoanStatementPosting> = {}): LoanStatementPosting => ({
  id,
  transactionType: 'SALE',
  transactionDate: new Date(Date.UTC(2026, 9, day)),
  createdAt: new Date(Date.UTC(2026, 9, day, 6)),
  referenceNo: null,
  description: null,
  status: 'POSTED',
  reversalOfId: null,
  ...overrides,
});

const loan = (id: string, day: number, entryType: 'DEBIT' | 'CREDIT', amount: number, overrides: Partial<LoanStatementPosting> = {}): LoanStatementItem => ({
  transaction: posting(id, day, overrides),
  principal: { entryType, amount: new Prisma.Decimal(amount) },
});

const profit = (id: string, day: number, amount: number, paid: boolean): LoanStatementItem => ({
  transaction: posting(id, day, { transactionType: paid ? 'EXPENSE' : 'INCOME' }),
  principal: null,
  profit: new Prisma.Decimal(amount),
});

describe('loanStatementRows', () => {
  it('says what each entry was: a loan given or taken, money back either way, or profit', () => {
    const rows = loanStatementRows(
      [
        loan('gave', 1, 'DEBIT', 1000),
        loan('took', 2, 'CREDIT', 5000, { transactionType: 'PURCHASE' }),
        loan('back', 3, 'CREDIT', 400, { transactionType: 'PAYMENT' }),
        loan('paid', 4, 'DEBIT', 600, { transactionType: 'PAYMENT' }),
        profit('interest', 5, 50, true),
        profit('earned', 6, 20, false),
      ],
      new Prisma.Decimal(0),
    );
    expect(rows.map((row) => row.kind)).toEqual(['GAVE', 'TOOK', 'GOT_BACK', 'PAID_BACK', 'PROFIT_PAID', 'PROFIT_RECEIVED']);
  });

  it('carries the principal through loans and repayments, oldest first', () => {
    const rows = loanStatementRows([loan('repaid', 10, 'CREDIT', 4000), loan('given', 1, 'DEBIT', 10000)], new Prisma.Decimal(500));
    expect(rows.map((row) => [row.transactionId, row.debit, row.credit, row.runningPrincipal])).toEqual([
      ['given', '10000.00', null, '10500.00'],
      ['repaid', null, '4000.00', '6500.00'],
    ]);
  });

  it('lists profit without moving the principal', () => {
    const rows = loanStatementRows([loan('given', 1, 'DEBIT', 10000), profit('interest', 5, 300, false), profit('fee', 6, 50, true)], new Prisma.Decimal(0));
    expect(rows.map((row) => [row.category, row.profitReceived, row.profitPaid, row.runningPrincipal])).toEqual([
      ['Principal', null, null, '10000.00'],
      ['Profit', '300.00', null, '10000.00'],
      ['Profit', null, '50.00', '10000.00'],
    ]);
  });

  // A loan entered by mistake and voided a week later: both rows stay on
  // the statement, flagged, and the balance never moves.
  it('shows a voided loan and its reversal without counting either', () => {
    const rows = loanStatementRows(
      [
        loan('given', 1, 'DEBIT', 2000),
        loan('mistake', 3, 'DEBIT', 9000, { status: 'VOIDED' }),
        loan('undo', 10, 'CREDIT', 9000, { reversalOfId: 'mistake' }),
        loan('repaid', 12, 'CREDIT', 500),
      ],
      new Prisma.Decimal(0),
    );
    expect(rows.map((row) => [row.transactionId, row.cancelled, row.reversalOfId, row.runningPrincipal])).toEqual([
      ['given', false, null, '2000.00'],
      ['mistake', true, null, '2000.00'],
      ['undo', true, 'mistake', '2000.00'],
      ['repaid', false, null, '1500.00'],
    ]);
  });

  it('flags a voided profit posting', () => {
    const [row] = loanStatementRows([{ ...profit('interest', 5, 300, false), transaction: posting('interest', 5, { transactionType: 'INCOME', status: 'VOIDED' }) }], new Prisma.Decimal(0));
    expect(row.cancelled).toBe(true);
    expect(row.profitReceived).toBe('300.00');
  });

  it('orders postings of one day by when they were made', () => {
    const later = loan('later', 4, 'CREDIT', 100, { createdAt: new Date(Date.UTC(2026, 9, 4, 9)) });
    const earlier = loan('earlier', 4, 'DEBIT', 1000, { createdAt: new Date(Date.UTC(2026, 9, 4, 8)) });
    expect(loanStatementRows([later, earlier], new Prisma.Decimal(0)).map((row) => row.transactionId)).toEqual(['earlier', 'later']);
  });
});
