import { computeCouponStatus } from './coupon-status.js';

const now = new Date('2026-10-17T04:00:00.000Z');
const live = { isActive: true, validFrom: new Date('2026-10-01T00:00:00.000Z'), validUntil: new Date('2026-12-31T23:59:59.000Z'), maxRedemptions: null, timesRedeemed: 3 };

describe('computeCouponStatus', () => {
  it('is live inside its window with uses left', () => {
    expect(computeCouponStatus(live, now)).toBe('ACTIVE');
    expect(computeCouponStatus({ ...live, maxRedemptions: 500, timesRedeemed: 214 }, now)).toBe('ACTIVE');
  });

  it('is used up once every allowed redemption is taken', () => {
    expect(computeCouponStatus({ ...live, maxRedemptions: 200, timesRedeemed: 200 }, now)).toBe('USED_UP');
  });

  it('is scheduled before it starts and expired after it ends', () => {
    expect(computeCouponStatus({ ...live, validFrom: new Date('2026-11-01T00:00:00.000Z') }, now)).toBe('SCHEDULED');
    expect(computeCouponStatus({ ...live, validUntil: new Date('2026-10-01T00:00:00.000Z') }, now)).toBe('EXPIRED');
  });

  it('is disabled whatever else is true', () => {
    expect(computeCouponStatus({ ...live, isActive: false, maxRedemptions: 1, timesRedeemed: 1 }, now)).toBe('DISABLED');
  });
});
