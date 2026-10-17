export type CouponStatus = 'ACTIVE' | 'SCHEDULED' | 'EXPIRED' | 'USED_UP' | 'DISABLED';

export interface CouponWindow {
  isActive: boolean;
  validFrom: Date;
  validUntil: Date;
  maxRedemptions: number | null;
  timesRedeemed: number;
}

// What a coupon is doing right now: switched off, not started, over, used
// up (every allowed redemption taken), or live.
export function computeCouponStatus(coupon: CouponWindow, now = new Date()): CouponStatus {
  if (!coupon.isActive) return 'DISABLED';
  if (now < coupon.validFrom) return 'SCHEDULED';
  if (now > coupon.validUntil) return 'EXPIRED';
  if (coupon.maxRedemptions !== null && coupon.timesRedeemed >= coupon.maxRedemptions) return 'USED_UP';
  return 'ACTIVE';
}
