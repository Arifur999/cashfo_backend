import { describe, expect, it } from 'vitest';
import { periodWhere } from './referral-earnings.service.js';

// Dhaka midnight is 18:00 UTC the evening before.
const at = (iso: string) => new Date(iso);

describe('periodWhere', () => {
  it('narrows nothing without a month or days', () => {
    expect(periodWhere({})).toEqual([]);
  });

  it('takes a month on the Dhaka calendar', () => {
    const range = { gte: at('2026-09-30T18:00:00.000Z'), lt: at('2026-10-31T18:00:00.000Z') };
    expect(periodWhere({ month: '2026-10' })).toEqual([{ OR: [{ payment: { paidAt: range } }, { paymentId: null, createdAt: range }] }]);
  });

  it('takes a run of days with both ends included', () => {
    const range = { gte: at('2026-07-31T18:00:00.000Z'), lt: at('2026-10-28T18:00:00.000Z') };
    expect(periodWhere({ dateFrom: '2026-08-01', dateTo: '2026-10-28' })).toEqual([
      { OR: [{ payment: { paidAt: range } }, { paymentId: null, createdAt: range }] },
    ]);
  });

  it('leaves an end open when only one day is sent', () => {
    const from = { gte: at('2025-12-31T18:00:00.000Z') };
    expect(periodWhere({ dateFrom: '2026-01-01' })).toEqual([{ OR: [{ payment: { paidAt: from } }, { paymentId: null, createdAt: from }] }]);
    const to = { lt: at('2026-12-31T18:00:00.000Z') };
    expect(periodWhere({ dateTo: '2026-12-31' })).toEqual([{ OR: [{ payment: { paidAt: to } }, { paymentId: null, createdAt: to }] }]);
  });
});
