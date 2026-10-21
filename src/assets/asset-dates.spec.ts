import { describe, expect, it } from 'vitest';
import { canMovePurchaseTo, isBeforePurchase, isNewestValuation, purchaseRowOf } from './asset-dates.js';

const bought = new Date('2026-03-15T00:00:00.000Z');

describe('isBeforePurchase', () => {
  it('refuses a day before the purchase and allows the day itself and later', () => {
    expect(isBeforePurchase('2026-03-14', bought)).toBe(true);
    expect(isBeforePurchase('2026-03-15', bought)).toBe(false);
    expect(isBeforePurchase('2026-10-01', bought)).toBe(false);
  });
});

describe('isNewestValuation', () => {
  it('is the newest when nothing was recorded yet', () => {
    expect(isNewestValuation('2026-04-01', null)).toBe(true);
  });

  it('is the newest on or after the latest recorded day', () => {
    const latest = new Date('2026-09-01T00:00:00.000Z');
    expect(isNewestValuation('2026-09-01', latest)).toBe(true);
    expect(isNewestValuation('2026-10-21', latest)).toBe(true);
  });

  // Filling in last spring's value must not replace today's.
  it('only fills in the history when it is older', () => {
    expect(isNewestValuation('2026-05-01', new Date('2026-09-01T00:00:00.000Z'))).toBe(false);
  });

  it('compares a history row made with a time of day by its day', () => {
    expect(isNewestValuation('2026-09-01', new Date('2026-09-01T17:45:00.000Z'))).toBe(true);
  });
});

const row = (id: string, recordedAt: string, note: string | null = null) => ({ id, recordedAt: new Date(recordedAt), note });

describe('purchaseRowOf', () => {
  it('is the oldest row', () => {
    expect(purchaseRowOf([row('check', '2026-10-21T00:00:00.000Z'), row('bought', '2019-03-01T00:00:00.000Z', 'Initial value')])?.id).toBe('bought');
  });

  // Added as already owned today, at another value: both rows carry today.
  it('prefers the purchase note on a shared day', () => {
    expect(purchaseRowOf([row('check', '2026-10-21T00:00:00.000Z'), row('bought', '2026-10-21T00:00:00.000Z', 'Initial value')])?.id).toBe('bought');
    expect(purchaseRowOf([row('bought', '2026-10-21T00:00:00.000Z', 'Initial value'), row('check', '2026-10-21T00:00:00.000Z')])?.id).toBe('bought');
  });

  it('is undefined without history', () => {
    expect(purchaseRowOf([])).toBeUndefined();
  });
});

describe('canMovePurchaseTo', () => {
  const history = [row('bought', '2019-03-01T00:00:00.000Z', 'Initial value'), row('check', '2026-10-21T00:00:00.000Z')];

  // The value check written when it was added as owned doesn't pin the date.
  it('moves the purchase anywhere up to the first value after it', () => {
    expect(canMovePurchaseTo('2018-06-01', history, 'bought')).toBe(true);
    expect(canMovePurchaseTo('2026-10-21', history, 'bought')).toBe(true);
  });

  it('refuses a day after a value recorded since', () => {
    expect(canMovePurchaseTo('2026-10-22', history, 'bought')).toBe(false);
  });

  it('moves freely with only the purchase row', () => {
    expect(canMovePurchaseTo('2026-10-22', [history[0]], 'bought')).toBe(true);
  });
});
