import { couponDiscountPaisa, couponProblem, fromPaisa, priceWith, referralDiscountPaisa, toPaisa, type CouponTerms } from './pricing.js';

const NOW = new Date('2026-10-27T06:00:00.000Z');
const coupon = (over: Partial<CouponTerms> = {}): CouponTerms => ({
  isActive: true,
  validFrom: new Date('2026-10-01T00:00:00.000Z'),
  validUntil: new Date('2026-11-30T00:00:00.000Z'),
  maxRedemptions: null,
  timesRedeemed: 0,
  applicablePlans: [],
  oncePerPerson: false,
  discountType: 'PERCENTAGE',
  discountValue: 20,
  ...over,
});

describe('paisa', () => {
  it('turns prices into whole paisa and back without float dust', () => {
    expect(toPaisa('299.00')).toBe(29900);
    expect(toPaisa(0.1 + 0.2)).toBe(30);
    expect(fromPaisa(26910)).toBe('269.10');
  });
});

describe('couponProblem', () => {
  it('accepts a live coupon for any plan', () => {
    expect(couponProblem(coupon(), 'monthly', NOW, false)).toBeNull();
  });

  it('names what is wrong, in the order a customer can fix least', () => {
    expect(couponProblem(null, 'monthly', NOW, false)).toBe('NOT_FOUND');
    expect(couponProblem(coupon({ isActive: false }), 'monthly', NOW, false)).toBe('NOT_FOUND');
    expect(couponProblem(coupon({ validFrom: new Date('2026-11-01T00:00:00.000Z') }), 'monthly', NOW, false)).toBe('NOT_STARTED');
    expect(couponProblem(coupon({ validUntil: new Date('2026-10-26T00:00:00.000Z') }), 'monthly', NOW, false)).toBe('EXPIRED');
    expect(couponProblem(coupon({ maxRedemptions: 5, timesRedeemed: 5 }), 'monthly', NOW, false)).toBe('USED_UP');
    expect(couponProblem(coupon({ applicablePlans: ['yearly'] }), 'monthly', NOW, false)).toBe('NOT_FOR_PLAN');
  });

  it('refuses a once-per-person coupon the person already used, and only that kind', () => {
    expect(couponProblem(coupon({ oncePerPerson: true }), 'monthly', NOW, true)).toBe('ALREADY_USED');
    expect(couponProblem(coupon({ oncePerPerson: false }), 'monthly', NOW, true)).toBeNull();
  });
});

describe('discounts', () => {
  it('rounds a percentage down to whole taka', () => {
    // 15% of 299 is 44.85
    expect(couponDiscountPaisa({ discountType: 'PERCENTAGE', discountValue: 15 }, 29900)).toBe(4400);
    expect(referralDiscountPaisa(29900, 10)).toBe(2900);
  });

  it('takes a fixed amount as it is, never more than the price', () => {
    expect(couponDiscountPaisa({ discountType: 'FIXED_AMOUNT', discountValue: '50.50' }, 29900)).toBe(5050);
    expect(couponDiscountPaisa({ discountType: 'FIXED_AMOUNT', discountValue: 500 }, 29900)).toBe(29900);
  });

  it('gives no friend discount at 0%', () => {
    expect(referralDiscountPaisa(29900, 0)).toBe(0);
  });
});

describe('priceWith', () => {
  it('charges the list price with no discount', () => {
    expect(priceWith(29900, null, null)).toEqual({ listPaisa: 29900, discountPaisa: 0, finalPaisa: 29900, source: null });
  });

  it('never stacks the coupon and the friend discount: the larger wins', () => {
    expect(priceWith(29900, 6000, 2900)).toEqual({ listPaisa: 29900, discountPaisa: 6000, finalPaisa: 23900, source: 'COUPON' });
    expect(priceWith(29900, 1000, 2900)).toEqual({ listPaisa: 29900, discountPaisa: 2900, finalPaisa: 27000, source: 'REFERRAL' });
  });

  it('uses the friend discount on a tie, keeping the coupon for later', () => {
    expect(priceWith(29900, 2900, 2900).source).toBe('REFERRAL');
  });

  it('never goes below zero', () => {
    expect(priceWith(29900, 50000, 0).finalPaisa).toBe(0);
  });
});
