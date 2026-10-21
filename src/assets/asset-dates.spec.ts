import { describe, expect, it } from 'vitest';
import { isBeforePurchase, isNewestValuation } from './asset-dates.js';

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
