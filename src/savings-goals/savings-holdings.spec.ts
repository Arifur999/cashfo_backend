import { describe, expect, it } from 'vitest';
import { entrySign, goalHoldings, splitLargestFirst, type HoldingEntry } from './savings-holdings.js';
import { Prisma } from '@prisma/client';

let seq = 0;
const entry = (over: Partial<HoldingEntry> & Pick<HoldingEntry, 'savingsGoalId' | 'type' | 'amount'>): HoldingEntry => {
  seq += 1;
  return { id: `e${String(seq).padStart(3, '0')}`, date: new Date('2026-10-01'), createdAt: new Date(2026, 9, 1, 0, 0, seq), savingsAccountId: null, moneyAccountId: null, groupId: null, ...over };
};
const plain = (holdings: Map<string, Prisma.Decimal> | undefined) => Object.fromEntries([...(holdings ?? new Map())].map(([k, v]) => [k, v.toNumber()]));

describe('splitLargestFirst', () => {
  it('takes from the largest holding first and stops when covered', () => {
    const holdings = new Map([
      ['dps', new Prisma.Decimal(25000)],
      ['fdr', new Prisma.Decimal(55000)],
    ]);
    expect(splitLargestFirst(holdings, 60000).map((p) => [p.walletId, p.amount.toNumber()])).toEqual([
      ['fdr', 55000],
      ['dps', 5000],
    ]);
  });

  it('takes only what is there', () => {
    const holdings = new Map([['dps', new Prisma.Decimal(100)]]);
    expect(splitLargestFirst(holdings, 500).map((p) => p.amount.toNumber())).toEqual([100]);
  });

  it('breaks a tie by wallet id', () => {
    const holdings = new Map([
      ['b', new Prisma.Decimal(10)],
      ['a', new Prisma.Decimal(10)],
    ]);
    expect(splitLargestFirst(holdings, 15).map((p) => p.walletId)).toEqual(['a', 'b']);
  });
});

describe('goalHoldings', () => {
  it('puts added money in the wallet it was kept in', () => {
    const byGoal = goalHoldings([
      entry({ savingsGoalId: 'g', type: 'CONTRIBUTION', amount: 1000, savingsAccountId: 'dps' }),
      entry({ savingsGoalId: 'g', type: 'CONTRIBUTION', amount: 500, savingsAccountId: 'fdr' }),
      entry({ savingsGoalId: 'g', type: 'CONTRIBUTION', amount: 200, savingsAccountId: 'dps' }),
    ]);
    expect(plain(byGoal.get('g'))).toEqual({ dps: 1200, fdr: 500 });
  });

  it('moves the named wallet with a move between goals', () => {
    const byGoal = goalHoldings([
      entry({ savingsGoalId: 'a', type: 'CONTRIBUTION', amount: 1000, savingsAccountId: 'dps' }),
      entry({ savingsGoalId: 'a', type: 'TRANSFER_OUT', amount: 400, savingsAccountId: 'dps', groupId: 'm1' }),
      entry({ savingsGoalId: 'b', type: 'TRANSFER_IN', amount: 400, savingsAccountId: 'dps', groupId: 'm1' }),
    ]);
    expect(plain(byGoal.get('a'))).toEqual({ dps: 600 });
    expect(plain(byGoal.get('b'))).toEqual({ dps: 400 });
  });

  it('splits an old move with no wallet largest-first and gives the other goal the same parts', () => {
    const byGoal = goalHoldings([
      entry({ savingsGoalId: 'a', type: 'CONTRIBUTION', amount: 300, savingsAccountId: 'dps' }),
      entry({ savingsGoalId: 'a', type: 'CONTRIBUTION', amount: 700, savingsAccountId: 'fdr' }),
      entry({ savingsGoalId: 'b', type: 'TRANSFER_IN', amount: 800, groupId: 'old', date: new Date('2026-10-05'), createdAt: new Date(2026, 9, 5) }),
      entry({ savingsGoalId: 'a', type: 'TRANSFER_OUT', amount: 800, groupId: 'old', date: new Date('2026-10-05'), createdAt: new Date(2026, 9, 5) }),
    ]);
    expect(plain(byGoal.get('a'))).toEqual({ dps: 200 });
    expect(plain(byGoal.get('b'))).toEqual({ fdr: 700, dps: 100 });
  });

  it("keeps an unpaired old move's money under an unknown wallet", () => {
    const byGoal = goalHoldings([entry({ savingsGoalId: 'b', type: 'TRANSFER_IN', amount: 50 })]);
    expect(plain(byGoal.get('b'))).toEqual({ '': 50 });
  });

  it('takes a withdrawal from its wallet, and any shortfall from the others', () => {
    const byGoal = goalHoldings([
      entry({ savingsGoalId: 'g', type: 'CONTRIBUTION', amount: 100, savingsAccountId: 'dps' }),
      entry({ savingsGoalId: 'g', type: 'CONTRIBUTION', amount: 900, savingsAccountId: 'fdr' }),
      entry({ savingsGoalId: 'g', type: 'WITHDRAWAL', amount: 300, savingsAccountId: 'dps' }),
    ]);
    expect(plain(byGoal.get('g'))).toEqual({ fdr: 700 });
  });

  it('drops a wallet the goal no longer holds anything in', () => {
    const byGoal = goalHoldings([
      entry({ savingsGoalId: 'g', type: 'CONTRIBUTION', amount: 100, savingsAccountId: 'dps' }),
      entry({ savingsGoalId: 'g', type: 'WITHDRAWAL', amount: 100 }),
    ]);
    expect(plain(byGoal.get('g'))).toEqual({});
  });

  it('replays in date order whatever order the entries come in', () => {
    const later = entry({ savingsGoalId: 'g', type: 'WITHDRAWAL', amount: 100, date: new Date('2026-10-09') });
    const first = entry({ savingsGoalId: 'g', type: 'CONTRIBUTION', amount: 100, savingsAccountId: 'dps', date: new Date('2026-10-02') });
    expect(plain(goalHoldings([later, first]).get('g'))).toEqual({});
  });
  it('carries the money of an account change from the wallet it left to the new one', () => {
    const parts = new Map();
    const change = entry({ savingsGoalId: 'g', type: 'ACCOUNT_CHANGE', amount: 300, moneyAccountId: 'dps', savingsAccountId: 'fdr', date: new Date('2026-10-05') });
    const byGoal = goalHoldings(
      [
        entry({ savingsGoalId: 'g', type: 'CONTRIBUTION', amount: 300, savingsAccountId: 'dps' }),
        entry({ savingsGoalId: 'g', type: 'CONTRIBUTION', amount: 50, savingsAccountId: 'fdr' }),
        change,
      ],
      parts,
    );
    expect(plain(byGoal.get('g'))).toEqual({ fdr: 350 });
    expect(parts.get(change.id).map((p: { walletId: string; amount: Prisma.Decimal }) => [p.walletId, p.amount.toNumber()])).toEqual([['dps', 300]]);
  });
});

describe('entrySign', () => {
  it('adds money in, takes money out, and leaves an account change at zero', () => {
    expect([entrySign('CONTRIBUTION'), entrySign('TRANSFER_IN'), entrySign('TRANSFER_OUT'), entrySign('WITHDRAWAL'), entrySign('ACCOUNT_CHANGE')]).toEqual([1, 1, -1, -1, 0]);
  });
});
