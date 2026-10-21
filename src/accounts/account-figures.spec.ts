import { Prisma } from '@prisma/client';
import { isDebitPositive as reExported } from './account-balance.service.js';
import { dayDate, dayWindow, entryTotals, isDebitPositive, periodFigures, signedNet, type EntryTypeSum } from './account-figures.js';

const sum = (accountId: string, entryType: 'DEBIT' | 'CREDIT', amount: string | null): EntryTypeSum => ({ accountId, entryType, _sum: { amount: amount === null ? null : new Prisma.Decimal(amount) } });

describe('account figures', () => {
  it('keeps the one accounting rule, still exported where ReportsService reads it', () => {
    expect(reExported).toBe(isDebitPositive);
    expect((['ASSET', 'EXPENSE', 'LIABILITY', 'EQUITY', 'INCOME'] as const).filter(isDebitPositive)).toEqual(['ASSET', 'EXPENSE']);
  });

  it('reads a calendar day as a @db.Date column holds it, and a window with both ends in', () => {
    expect(dayDate('2026-10-21')).toEqual(new Date('2026-10-21T00:00:00.000Z'));
    expect(dayWindow({})).toBeUndefined();
    expect(dayWindow({ dateFrom: '2026-01-01', dateTo: '2026-12-31' })).toEqual({ gte: dayDate('2026-01-01'), lte: dayDate('2026-12-31') });
    expect(dayWindow({ dateFrom: '2026-01-01' })).toEqual({ gte: dayDate('2026-01-01') });
    expect(dayWindow({ dateTo: '2026-12-31' })).toEqual({ lte: dayDate('2026-12-31') });
  });

  it("folds a groupBy into each account's debits and credits", () => {
    const totals = entryTotals([sum('cash', 'DEBIT', '1000.50'), sum('sales', 'CREDIT', '1000.50'), sum('cash', 'CREDIT', '200'), sum('rent', 'DEBIT', null)]);
    const read = (accountId: string) => {
      const found = totals.get(accountId);
      return found && [found.debit.toFixed(2), found.credit.toFixed(2)];
    };
    expect([...totals.keys()]).toEqual(['cash', 'sales', 'rent']);
    expect(read('cash')).toEqual(['1000.50', '200.00']);
    expect(read('sales')).toEqual(['0.00', '1000.50']);
    expect(read('rent')).toEqual(['0.00', '0.00']);
    expect(read('elsewhere')).toBeUndefined();
  });

  // The same debits and credits read in opposite directions depending on
  // which way the account's type grows.
  it.each([
    ['ASSET', '-450.00'],
    ['EXPENSE', '-450.00'],
    ['LIABILITY', '450.00'],
    ['EQUITY', '450.00'],
    ['INCOME', '450.00'],
  ] as const)('signs a %s account by its own direction', (accountType, net) => {
    const totals = { debit: new Prisma.Decimal(50), credit: new Prisma.Decimal(500) };
    expect(signedNet(accountType, totals).toFixed(2)).toBe(net);
    expect(periodFigures(accountType, totals)).toEqual({ periodDebit: '50.00', periodCredit: '500.00', periodNet: net });
  });

  it('reads an account with no entries as all zero', () => {
    expect(signedNet('INCOME').toFixed(2)).toBe('0.00');
    expect(periodFigures('EXPENSE')).toEqual({ periodDebit: '0.00', periodCredit: '0.00', periodNet: '0.00' });
  });
});
