import { expectedRenewalEarnings, friendPaidOutcome, friendRefundedOutcome, friendStanding, isBlockedSignup, type FriendPaidInput } from './referral-rules.js';

const PAID_AT = new Date('2026-09-28T06:00:00.000Z');
const paid = (over: Partial<FriendPaidInput> = {}): FriendPaidInput => ({
  programLive: true,
  whoCanEarn: 'PAID_PLAN',
  referrerOnPaidPlan: true,
  paidPaisa: 270_000,
  commissionPct: 20,
  holdDays: 7,
  paidAt: PAID_AT,
  now: PAID_AT,
  ...over,
});

describe('friendPaidOutcome', () => {
  it('holds the commission for the refund window', () => {
    expect(friendPaidOutcome(paid())).toEqual({ status: 'ON_HOLD', commissionPaisa: 54_000, availableAt: new Date('2026-10-05T06:00:00.000Z') });
  });

  it('is available at once when the window is already over (no hold days)', () => {
    expect(friendPaidOutcome(paid({ holdDays: 0 }))).toMatchObject({ status: 'AVAILABLE', availableAt: PAID_AT });
  });

  it('earns nothing when the referrer is not on a paid plan (a trial is not paid)', () => {
    expect(friendPaidOutcome(paid({ referrerOnPaidPlan: false }))).toEqual({
      status: 'CANCELLED',
      commissionPaisa: 54_000,
      availableAt: new Date('2026-10-05T06:00:00.000Z'),
      reason: 'REFERRER_NOT_ON_PAID_PLAN',
    });
  });

  it('lets everyone earn when the program says so', () => {
    expect(friendPaidOutcome(paid({ referrerOnPaidPlan: false, whoCanEarn: 'EVERYONE' })).status).toBe('ON_HOLD');
  });

  it('earns nothing while the program is off', () => {
    expect(friendPaidOutcome(paid({ programLive: false }))).toMatchObject({ status: 'CANCELLED', reason: 'PROGRAM_OFF' });
  });
});

describe('friendRefundedOutcome', () => {
  const base = {
    status: 'ON_HOLD' as const,
    availableAt: new Date('2026-10-05T06:00:00.000Z'),
    cancelOnRefund: true,
    paidPaisa: 270_000,
    refundPaisa: 270_000,
    full: true,
    commissionRatePct: 20,
    now: new Date('2026-10-01T06:00:00.000Z'),
  };

  it('reverses the commission on a full refund inside the window', () => {
    expect(friendRefundedOutcome(base)).toEqual({ action: 'REVERSE' });
  });

  it('keeps a commission on what was kept after a partial refund', () => {
    expect(friendRefundedOutcome({ ...base, refundPaisa: 70_000, full: false })).toEqual({ action: 'REDUCE', commissionPaisa: 40_000 });
  });

  it('changes nothing after the window, once available, or with the setting off', () => {
    expect(friendRefundedOutcome({ ...base, now: new Date('2026-10-06T06:00:00.000Z') })).toBeNull();
    expect(friendRefundedOutcome({ ...base, status: 'AVAILABLE' })).toBeNull();
    expect(friendRefundedOutcome({ ...base, cancelOnRefund: false })).toBeNull();
  });
});

describe('friendStanding', () => {
  const none = { blocked: false, onPaidPlan: false, paidCount: 0, refundedCount: 0 };

  it('sorts friends by how they stand', () => {
    expect(friendStanding(none)).toBe('FREE');
    expect(friendStanding({ ...none, onPaidPlan: true, paidCount: 1 })).toBe('PAYING');
    expect(friendStanding({ ...none, paidCount: 2 })).toBe('STOPPED');
    expect(friendStanding({ ...none, refundedCount: 1 })).toBe('REFUNDED');
    expect(friendStanding({ ...none, blocked: true, onPaidPlan: true })).toBe('BLOCKED');
  });
});

describe('isBlockedSignup', () => {
  it('blocks only a self-referral or a sign-up past the monthly limit', () => {
    expect(isBlockedSignup({ status: 'CANCELLED', cancelReason: 'SELF_REFERRAL' })).toBe(true);
    expect(isBlockedSignup({ status: 'CANCELLED', cancelReason: 'MONTHLY_LIMIT' })).toBe(true);
    // A pre-v9 friend whose first payment was refunded still earns on renewals.
    expect(isBlockedSignup({ status: 'CANCELLED', cancelReason: 'FRIEND_REFUNDED' })).toBe(false);
    expect(isBlockedSignup({ status: 'JOINED', cancelReason: null })).toBe(false);
  });
});

describe('expectedRenewalEarnings', () => {
  const dec = new Date('2026-11-30T18:00:00.000Z'); // 1 Dec in Dhaka
  const jan = new Date('2026-12-31T18:00:00.000Z');
  const friends = [
    { periodEnd: new Date('2026-12-05T00:00:00.000Z'), pricePaisa: 19_900 },
    { periodEnd: new Date('2026-12-31T17:59:59.000Z'), pricePaisa: 191_000 },
    { periodEnd: jan, pricePaisa: 19_900 },
    { periodEnd: new Date('2026-11-20T00:00:00.000Z'), pricePaisa: 19_900 },
    { periodEnd: null, pricePaisa: 19_900 },
  ];

  it('counts the renewals inside the window, end excluded, at the rate', () => {
    expect(expectedRenewalEarnings(friends, dec, jan, 20)).toEqual({ paisa: 3_980 + 38_200, count: 2 });
  });

  it('includes a renewal on the first instant, and is nothing with no friends', () => {
    expect(expectedRenewalEarnings(friends, jan, new Date('2027-01-01T00:00:00.000Z'), 20)).toEqual({ paisa: 3_980, count: 1 });
    expect(expectedRenewalEarnings([], dec, jan, 20)).toEqual({ paisa: 0, count: 0 });
  });
});
