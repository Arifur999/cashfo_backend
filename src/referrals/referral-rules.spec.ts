import { friendFilterOf, friendPaidOutcome, friendRefundedOutcome, type FriendPaidInput } from './referral-rules.js';

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
    expect(friendPaidOutcome(paid())).toEqual({ status: 'PENDING', commissionPaisa: 54_000, availableAt: new Date('2026-10-05T06:00:00.000Z') });
  });

  it('is available at once when the window is already over (no hold days)', () => {
    expect(friendPaidOutcome(paid({ holdDays: 0 }))).toMatchObject({ status: 'AVAILABLE', availableAt: PAID_AT });
  });

  it('earns nothing when the referrer is not on a paid plan (a trial is not paid)', () => {
    expect(friendPaidOutcome(paid({ referrerOnPaidPlan: false }))).toEqual({
      status: 'CANCELLED',
      commissionPaisa: 54_000,
      reason: 'REFERRER_NOT_ON_PAID_PLAN',
    });
  });

  it('lets everyone earn when the program says so', () => {
    expect(friendPaidOutcome(paid({ referrerOnPaidPlan: false, whoCanEarn: 'EVERYONE' })).status).toBe('PENDING');
  });

  it('earns nothing while the program is off', () => {
    expect(friendPaidOutcome(paid({ programLive: false }))).toMatchObject({ status: 'CANCELLED', reason: 'PROGRAM_OFF' });
  });
});

describe('friendRefundedOutcome', () => {
  const base = {
    status: 'PENDING' as const,
    availableAt: new Date('2026-10-05T06:00:00.000Z'),
    cancelOnRefund: true,
    paidPaisa: 270_000,
    refundPaisa: 270_000,
    full: true,
    commissionRatePct: 20,
    now: new Date('2026-10-01T06:00:00.000Z'),
  };

  it('cancels the commission on a full refund inside the window', () => {
    expect(friendRefundedOutcome(base)).toEqual({ action: 'CANCEL' });
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

describe('friendFilterOf', () => {
  it('sorts friends into the page tabs', () => {
    expect(friendFilterOf({ status: 'JOINED', paymentId: null, cancelReason: null })).toBe('NOT_YET');
    expect(friendFilterOf({ status: 'PENDING', paymentId: 'p', cancelReason: null })).toBe('BOUGHT');
    expect(friendFilterOf({ status: 'PAID_OUT', paymentId: 'p', cancelReason: null })).toBe('BOUGHT');
    expect(friendFilterOf({ status: 'CANCELLED', paymentId: 'p', cancelReason: 'REFERRER_NOT_ON_PAID_PLAN' })).toBe('BOUGHT');
    expect(friendFilterOf({ status: 'CANCELLED', paymentId: 'p', cancelReason: 'FRIEND_REFUNDED' })).toBe('REFUNDED');
    expect(friendFilterOf({ status: 'AVAILABLE', paymentId: null, cancelReason: null })).toBe('OTHER');
    expect(friendFilterOf({ status: 'CANCELLED', paymentId: null, cancelReason: 'SELF_REFERRAL' })).toBe('OTHER');
  });
});
