import { accountsByPlan, lastFullMonths, pctChange, perDhakaDay, periodDays, shareOf, ticketsNoReply, waitingForReply } from './dashboard-maths.js';

describe('pctChange and shareOf', () => {
  it('rounds to one decimal and has nothing to compare with after zero', () => {
    expect(pctChange(60_404, 57_969)).toBe(4.2);
    expect(pctChange(90, 100)).toBe(-10);
    expect(pctChange(5, 0)).toBeNull();
    expect(shareOf(196, 1272)).toBe(15.4);
    expect(shareOf(3, 0)).toBe(0);
  });
});

describe('perDhakaDay', () => {
  it('counts sign-ups per Dhaka day, oldest first, with empty days', () => {
    // 2 Oct 2026 01:00 in Dhaka.
    const now = new Date('2026-10-01T19:00:00.000Z');
    const rows = perDhakaDay(
      [
        new Date('2026-10-01T18:30:00.000Z'), // 2 Oct 00:30 Dhaka
        new Date('2026-10-01T17:00:00.000Z'), // 1 Oct 23:00 Dhaka
        new Date('2026-09-30T10:00:00.000Z'),
      ],
      3,
      now,
    );
    expect(rows).toEqual([
      { date: '2026-09-30', count: 1 },
      { date: '2026-10-01', count: 1 },
      { date: '2026-10-02', count: 1 },
    ]);
    expect(periodDays('90d')).toBe(90);
  });
});

describe('tickets with no reply', () => {
  const at = (iso: string) => new Date(iso);

  it("waits on the customer's newest message, or the opening when nobody wrote", () => {
    expect(waitingForReply({ status: 'OPEN', createdAt: at('2026-10-02T01:00Z'), newest: null })).toEqual(at('2026-10-02T01:00Z'));
    expect(
      waitingForReply({ status: 'IN_PROGRESS', createdAt: at('2026-10-01T00:00Z'), newest: { senderType: 'USER', createdAt: at('2026-10-02T03:00Z') } }),
    ).toEqual(at('2026-10-02T03:00Z'));
    expect(
      waitingForReply({ status: 'IN_PROGRESS', createdAt: at('2026-10-01T00:00Z'), newest: { senderType: 'ADMIN', createdAt: at('2026-10-02T03:00Z') } }),
    ).toBeNull();
    expect(waitingForReply({ status: 'RESOLVED', createdAt: at('2026-10-01T00:00Z'), newest: null })).toBeNull();
  });

  it('counts them and finds the longest wait', () => {
    const result = ticketsNoReply([
      { status: 'OPEN', createdAt: at('2026-10-02T06:00Z'), newest: null },
      { status: 'OPEN', createdAt: at('2026-10-01T00:00Z'), newest: { senderType: 'USER', createdAt: at('2026-10-02T00:00Z') } },
      { status: 'WAITING_ON_USER', createdAt: at('2026-09-01T00:00Z'), newest: { senderType: 'ADMIN', createdAt: at('2026-09-02T00:00Z') } },
    ]);
    expect(result).toEqual({ count: 2, oldestWaitingSince: at('2026-10-02T00:00Z') });
    expect(ticketsNoReply([])).toEqual({ count: 0, oldestWaitingSince: null });
  });
});

describe('accountsByPlan', () => {
  it("puts customers with no subscription under the free plan and gives each plan's share", () => {
    const plans = [
      { id: 'free', name: 'Free', price: 0, billingCycle: 'FREE' },
      { id: 'monthly', name: 'Monthly Pro', price: 299, billingCycle: 'MONTHLY' },
      { id: 'yearly', name: 'Yearly Pro', price: 2999, billingCycle: 'YEARLY' },
    ];
    const rows = accountsByPlan(
      plans,
      new Map<string | null, number>([
        ['free', 70],
        ['monthly', 20],
        [null, 10],
      ]),
    );
    expect(rows).toEqual([
      { planId: 'free', name: 'Free', price: '0.00', billingCycle: 'FREE', count: 80, pct: 80 },
      { planId: 'monthly', name: 'Monthly Pro', price: '299.00', billingCycle: 'MONTHLY', count: 20, pct: 20 },
      { planId: 'yearly', name: 'Yearly Pro', price: '2999.00', billingCycle: 'YEARLY', count: 0, pct: 0 },
    ]);
  });
});

describe('lastFullMonths', () => {
  it('leaves out the month still running and compares the last two whole ones', () => {
    const trend = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].map((month, i) => ({
      month,
      amount: 1000 * (i + 1),
    }));
    trend[6].amount = 72_155;
    trend[5].amount = 64_120;
    const { months, changePct } = lastFullMonths(trend, '2026-10', 6);
    expect(months.map((row) => row.month)).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
    expect(changePct).toBe(12.5);
  });
});
