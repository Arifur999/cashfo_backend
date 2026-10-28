import type { DiscountType } from '@prisma/client';

// Prices are worked out in paisa (whole numbers), so 299.00 - 29.90 never
// turns into 269.09999.
export const toPaisa = (value: { toString(): string } | number | string): number => Math.round(Number(value.toString()) * 100);
export const fromPaisa = (paisa: number): string => (paisa / 100).toFixed(2);

// Why a coupon can't be used: unknown or switched off, not started yet,
// over, every allowed use taken, not for this plan, or (a once-per-person
// coupon) this person used it already.
export type CouponProblem = 'NOT_FOUND' | 'NOT_STARTED' | 'EXPIRED' | 'USED_UP' | 'NOT_FOR_PLAN' | 'ALREADY_USED';

export interface CouponTerms {
  isActive: boolean;
  validFrom: Date;
  validUntil: Date;
  maxRedemptions: number | null;
  timesRedeemed: number;
  applicablePlans: string[];
  oncePerPerson: boolean;
  discountType: DiscountType;
  discountValue: { toString(): string } | number;
}

export function couponProblem(coupon: CouponTerms | null, planId: string, now: Date, usedByThisPerson: boolean): CouponProblem | null {
  if (!coupon || !coupon.isActive) return 'NOT_FOUND';
  if (now < coupon.validFrom) return 'NOT_STARTED';
  if (now > coupon.validUntil) return 'EXPIRED';
  if (coupon.maxRedemptions !== null && coupon.timesRedeemed >= coupon.maxRedemptions) return 'USED_UP';
  if (coupon.applicablePlans.length > 0 && !coupon.applicablePlans.includes(planId)) return 'NOT_FOR_PLAN';
  if (coupon.oncePerPerson && usedByThisPerson) return 'ALREADY_USED';
  return null;
}

// Percentages round down to whole taka (so the price stays a round
// number); a fixed amount is taken as it is. Never more than the price.
export function couponDiscountPaisa(coupon: Pick<CouponTerms, 'discountType' | 'discountValue'>, listPaisa: number): number {
  const value = Number(coupon.discountValue.toString());
  const raw = coupon.discountType === 'PERCENTAGE' ? Math.floor((listPaisa * value) / 100 / 100) * 100 : Math.round(value * 100);
  return Math.max(0, Math.min(raw, listPaisa));
}

// The invited friend's first-payment discount, rounded down to whole taka.
export function referralDiscountPaisa(listPaisa: number, percent: number): number {
  if (!(percent > 0)) return 0;
  return Math.max(0, Math.min(Math.floor((listPaisa * percent) / 100 / 100) * 100, listPaisa));
}

export type DiscountSource = 'COUPON' | 'REFERRAL';

export interface Price {
  listPaisa: number;
  discountPaisa: number;
  finalPaisa: number;
  // Which discount was used; null when neither applies.
  source: DiscountSource | null;
}

// The coupon and the friend's discount don't stack: the larger one wins.
// On a tie the friend's discount is used, so a once-per-person coupon is
// kept for later.
export function priceWith(listPaisa: number, couponPaisa: number | null, referralPaisa: number | null): Price {
  const coupon = couponPaisa ?? 0;
  const referral = referralPaisa ?? 0;
  if (coupon <= 0 && referral <= 0) return { listPaisa, discountPaisa: 0, finalPaisa: listPaisa, source: null };
  const source: DiscountSource = coupon > referral ? 'COUPON' : 'REFERRAL';
  const discountPaisa = Math.min(source === 'COUPON' ? coupon : referral, listPaisa);
  return { listPaisa, discountPaisa, finalPaisa: listPaisa - discountPaisa, source };
}
