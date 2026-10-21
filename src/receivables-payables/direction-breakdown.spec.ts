import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { directionBreakdown, type DirectionPosting } from './direction-breakdown.js';

const AR = 'acc-receivable';
const CASH = 'acc-cash';
const today = new Date('2026-10-21T00:00:00.000Z');

const sale = (id: string, day: string, amount: number, dueDate?: string): DirectionPosting => ({
  id,
  transactionDate: new Date(`${day}T00:00:00.000Z`),
  description: id,
  dueDate: dueDate ? new Date(`${dueDate}T00:00:00.000Z`) : null,
  appliedToTransactionId: null,
  entries: [
    { accountId: AR, amount: new Prisma.Decimal(amount) },
    { accountId: 'acc-sales', amount: new Prisma.Decimal(amount) },
  ],
});

const payment = (id: string, amount: number, appliedTo: string | null = null, accountId = AR): DirectionPosting => ({
  id,
  transactionDate: new Date('2026-10-01T00:00:00.000Z'),
  description: id,
  dueDate: null,
  appliedToTransactionId: appliedTo,
  entries: [
    { accountId, amount: new Prisma.Decimal(amount) },
    { accountId: CASH, amount: new Prisma.Decimal(amount) },
  ],
});

const owed = (breakdown: ReturnType<typeof directionBreakdown>) => breakdown.transactions.map((t) => [t.transactionId, t.amountPaid, t.remainingAmount]);

describe('directionBreakdown', () => {
  it('settles the oldest invoices first with general payments', () => {
    const breakdown = directionBreakdown(0, 'RECEIVABLE', AR, [sale('march', '2026-03-01', 1000), sale('april', '2026-04-01', 500)], [payment('p1', 1200)], today);
    expect(owed(breakdown)).toEqual([
      ['march', '1000.00', '0.00'],
      ['april', '200.00', '300.00'],
    ]);
    expect(breakdown.balance).toBe('300.00');
    expect(breakdown.remaining).toBe('300.00');
  });

  it('puts a payment applied to an invoice on that invoice', () => {
    const breakdown = directionBreakdown(0, 'RECEIVABLE', AR, [sale('march', '2026-03-01', 1000), sale('april', '2026-04-01', 500)], [payment('p1', 500, 'april')], today);
    expect(owed(breakdown)).toEqual([
      ['march', '0.00', '1000.00'],
      ['april', '500.00', '0.00'],
    ]);
  });

  // The opening balance is the oldest amount owed.
  it('settles the opening balance before any invoice', () => {
    const breakdown = directionBreakdown(400, 'RECEIVABLE', AR, [sale('march', '2026-03-01', 1000)], [payment('p1', 600)], today);
    expect(breakdown.openingOwed).toBe('400.00');
    expect(breakdown.openingRemaining).toBe('0.00');
    expect(owed(breakdown)).toEqual([['march', '200.00', '800.00']]);
    expect(breakdown.remaining).toBe('800.00');
    // The side's change to the balance; the opening balance is added once on top.
    expect(breakdown.balance).toBe('400.00');
  });

  it('reads a negative opening balance as owed on the payable side only', () => {
    expect(directionBreakdown(-700, 'PAYABLE', 'acc-payable', [], [], today).openingOwed).toBe('700.00');
    expect(directionBreakdown(-700, 'RECEIVABLE', AR, [], [], today).openingOwed).toBe('0.00');
  });

  // A contact on both sides: a payment on the payable doesn't settle a sale.
  it("ignores payments that don't touch this side's account", () => {
    const breakdown = directionBreakdown(0, 'RECEIVABLE', AR, [sale('march', '2026-03-01', 1000)], [payment('paid-them', 300, null, 'acc-payable')], today);
    expect(breakdown.totalPaid).toBe('0.00');
    expect(owed(breakdown)).toEqual([['march', '0.00', '1000.00']]);
  });

  it('flags an unpaid invoice past its due date as overdue', () => {
    const breakdown = directionBreakdown(0, 'RECEIVABLE', AR, [sale('late', '2026-09-01', 100, '2026-10-01'), sale('paid', '2026-09-02', 50, '2026-10-01'), sale('soon', '2026-10-10', 80, '2026-10-30')], [payment('p1', 50, 'paid')], today);
    expect(breakdown.transactions.map((t) => [t.transactionId, t.isOverdue])).toEqual([
      ['late', true],
      ['paid', false],
      ['soon', false],
    ]);
  });

  it('answers zeros, with the opening balance still owed, when the workspace has no such account', () => {
    expect(directionBreakdown(250, 'RECEIVABLE', null, [sale('march', '2026-03-01', 1000)], [payment('p1', 100)], today)).toEqual({
      totalInvoiced: '0.00',
      totalPaid: '0.00',
      remaining: '0.00',
      openingOwed: '250.00',
      openingRemaining: '250.00',
      balance: '0.00',
      transactions: [],
    });
  });
});
