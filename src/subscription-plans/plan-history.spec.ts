import { BillingCycle } from '@prisma/client';
import { monthEnds, paidPeopleAtMonthEnds } from './plan-history.js';

const PLANS = [
  { id: 'monthly', billingCycle: BillingCycle.MONTHLY },
  { id: 'yearly', billingCycle: BillingCycle.YEARLY },
];

describe('monthEnds', () => {
  it('lists the last months oldest first, the running month ending now', () => {
    const now = new Date('2026-10-17T04:00:00.000Z');
    const ends = monthEnds(now, 3);

    expect(ends.map((end) => end.month)).toEqual(['2026-08', '2026-09', '2026-10']);
    // September is over at Dhaka midnight on 1 October, which is 18:00 UTC the evening before.
    expect(ends[1].at.toISOString()).toBe('2026-09-30T18:00:00.000Z');
    expect(ends[2].at).toBe(now);
  });

  it('counts the Dhaka month, not UTC', () => {
    // 23:00 UTC on 30 September is already 1 October in Dhaka.
    const ends = monthEnds(new Date('2026-09-30T23:00:00.000Z'), 1);
    expect(ends[0].month).toBe('2026-10');
  });
});

describe('paidPeopleAtMonthEnds', () => {
  const ends = monthEnds(new Date('2026-10-17T04:00:00.000Z'), 3);

  it('keeps a monthly payer for one month and a yearly payer for twelve', () => {
    const payments = [
      { platformUserId: 'a', planId: 'monthly', paidAt: new Date('2026-08-10T10:00:00.000Z') },
      { platformUserId: 'b', planId: 'yearly', paidAt: new Date('2026-01-05T10:00:00.000Z') },
    ];

    expect(paidPeopleAtMonthEnds(payments, PLANS, ends)).toEqual([
      { month: '2026-08', perPlan: { monthly: 1, yearly: 1 } },
      { month: '2026-09', perPlan: { monthly: 0, yearly: 1 } },
      { month: '2026-10', perPlan: { monthly: 0, yearly: 1 } },
    ]);
  });

  it('counts a person once however many times they paid, and ignores unknown plans', () => {
    const payments = [
      { platformUserId: 'a', planId: 'monthly', paidAt: new Date('2026-09-01T10:00:00.000Z') },
      { platformUserId: 'a', planId: 'monthly', paidAt: new Date('2026-09-20T10:00:00.000Z') },
      { platformUserId: 'c', planId: 'gone', paidAt: new Date('2026-09-20T10:00:00.000Z') },
    ];

    expect(paidPeopleAtMonthEnds(payments, PLANS, ends)[1]).toEqual({ month: '2026-09', perPlan: { monthly: 1, yearly: 0 } });
  });
});
