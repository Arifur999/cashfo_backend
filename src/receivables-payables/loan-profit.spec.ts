import { describe, expect, it } from 'vitest';
import { profitTotals } from './loan-profit.js';

const at = (day: string) => new Date(`${day}T06:00:00.000Z`);

describe('profitTotals', () => {
  it('sums profit per contact and this year, and finds who most went to', () => {
    const postings = [
      ...['2026-01-31', '2026-02-28', '2026-03-31'].map((day) => ({ contactId: 'bank', date: at(day), amount: 5000, paid: true })),
      { contactId: 'bank', date: at('2025-12-31'), amount: 5000, paid: true },
      { contactId: 'ngo', date: at('2026-03-10'), amount: 1200, paid: true },
      { contactId: 'rahim', date: at('2026-04-01'), amount: 800, paid: false },
    ];
    const totals = profitTotals(postings, 2026);
    expect(totals.byContact.get('bank')).toEqual({ paid: 20000, received: 0 });
    expect(totals.byContact.get('rahim')).toEqual({ paid: 0, received: 800 });
    expect(totals.paidThisYear).toBe(16200);
    expect(totals.top).toEqual({ contactId: 'bank', monthly: 5000 });
  });

  it('reads the year on the Asia/Dhaka calendar', () => {
    // 31 Dec 2025, 20:00 UTC is already 1 January 2026 in Dhaka.
    const totals = profitTotals([{ contactId: 'bank', date: new Date('2025-12-31T20:00:00.000Z'), amount: 500, paid: true }], 2026);
    expect(totals.paidThisYear).toBe(500);
  });

  it('has no top contact without profit paid this year', () => {
    expect(profitTotals([], 2026)).toMatchObject({ paidThisYear: 0, top: null });
  });
});
