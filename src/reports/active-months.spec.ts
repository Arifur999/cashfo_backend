import { describe, expect, it } from 'vitest';
import { activeMonthsWhere } from './active-months.js';

describe('activeMonthsWhere', () => {
  it('counts income and expense by default, never a voided one', () => {
    expect(activeMonthsWhere('b-1')).toEqual({ businessId: 'b-1', status: 'POSTED', reversalOfId: null, transactionType: { in: ['INCOME', 'EXPENSE'] } });
  });

  it('counts everything on one account for its ledger', () => {
    expect(activeMonthsWhere('b-1', { accountId: 'a-1', scope: 'transfers' })).toEqual({
      businessId: 'b-1',
      status: 'POSTED',
      reversalOfId: null,
      entries: { some: { accountId: 'a-1' } },
    });
  });

  it('counts transfers as the Transfers page lists them, without savings goals', () => {
    expect(activeMonthsWhere('b-1', { scope: 'transfers' })).toEqual({
      businessId: 'b-1',
      status: 'POSTED',
      reversalOfId: null,
      transactionType: 'TRANSFER',
      NOT: { entries: { some: { account: { accountSubtype: 'savings' } } } },
    });
  });
});
