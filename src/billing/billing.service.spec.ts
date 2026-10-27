import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BillingService } from './billing.service.js';

const MONTHLY = {
  id: 'monthly',
  name: 'Monthly Pro',
  slug: 'monthly-pro',
  billingCycle: 'MONTHLY',
  price: '299.00',
  currency: 'BDT',
  isActive: true,
  trialDays: 7,
  featureLimits: {},
};
const FREE_SUB = { userId: 'u-1', planId: 'free', status: 'ACTIVE', currentPeriodEnd: null, trialUsedAt: null, plan: { billingCycle: 'FREE' } };
const coupon = (over: Record<string, unknown> = {}) => ({
  id: 'c-1',
  code: 'EID20',
  isActive: true,
  validFrom: new Date('2020-01-01T00:00:00.000Z'),
  validUntil: new Date('2099-01-01T00:00:00.000Z'),
  maxRedemptions: null,
  timesRedeemed: 0,
  applicablePlans: [],
  oncePerPerson: false,
  discountType: 'PERCENTAGE',
  discountValue: '20',
  ...over,
});

const setup = ({
  referred = false,
  paidBefore = 0,
  found = coupon() as Record<string, unknown> | null,
  usedBefore = 0,
  sub = FREE_SUB as Record<string, unknown>,
} = {}) => {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    payment: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn((args: { data: Record<string, unknown> }) => Promise.resolve({ id: 'abcd1234-0000', expiresAt: new Date(), ...args.data })),
    },
  };
  const prisma = {
    subscriptionPlan: { findUnique: vi.fn().mockResolvedValue(MONTHLY) },
    referral: { findUnique: vi.fn().mockResolvedValue(referred ? { id: 'r-1' } : null) },
    payment: { count: vi.fn().mockResolvedValue(paidBefore) },
    coupon: { findUnique: vi.fn().mockResolvedValue(found) },
    couponRedemption: { count: vi.fn().mockResolvedValue(usedBefore) },
    $transaction: vi.fn((run: (client: typeof tx) => Promise<unknown>) => run(tx)),
  };
  const subscriptions = { ensure: vi.fn().mockResolvedValue(sub) };
  const provider = { startCheckout: vi.fn().mockResolvedValue({ kind: 'instructions', text: { en: 'Send it', bn: 'পাঠান' } }) };
  const gateways = { providerFor: vi.fn().mockReturnValue(provider) };
  const settings = {
    getCached: vi.fn().mockResolvedValue({ billingCheckoutHours: 48 }),
    getReferralPrice: vi.fn().mockResolvedValue({ programLive: true, friendDiscountPct: 10 }),
  };
  const service = new BillingService(prisma as never, subscriptions as never, gateways as never, settings as never);
  return { service, prisma, tx, gateways };
};

describe('BillingService.couponPreview', () => {
  it('takes the coupon off the list price', async () => {
    const { service } = setup();
    await expect(service.couponPreview('u-1', { planId: 'monthly', code: 'eid20' })).resolves.toMatchObject({
      valid: true,
      listPrice: '299.00',
      discount: '59.00',
      finalAmount: '240.00',
      discountSource: 'COUPON',
    });
  });

  it("keeps the invited friend's bigger discount instead of a smaller coupon", async () => {
    const { service } = setup({ referred: true, found: coupon({ discountType: 'FIXED_AMOUNT', discountValue: '10' }) });
    await expect(service.couponPreview('u-1', { planId: 'monthly', code: 'TEN' })).resolves.toMatchObject({
      valid: true,
      discount: '29.00',
      finalAmount: '270.00',
      discountSource: 'REFERRAL',
      couponDiscount: '10.00',
      referralDiscount: '29.00',
    });
  });

  it('gives the friend discount on the first payment only', async () => {
    const { service } = setup({ referred: true, paidBefore: 1, found: null });
    await expect(service.couponPreview('u-1', { planId: 'monthly', code: 'NOPE' })).resolves.toMatchObject({
      valid: false,
      reason: 'NOT_FOUND',
      discount: '0.00',
      finalAmount: '299.00',
    });
  });

  it('refuses a once-per-person coupon used before', async () => {
    const { service } = setup({ found: coupon({ oncePerPerson: true }), usedBefore: 1 });
    await expect(service.couponPreview('u-1', { planId: 'monthly', code: 'EID20' })).resolves.toMatchObject({ valid: false, reason: 'ALREADY_USED' });
  });
});

describe('BillingService.checkout', () => {
  it("replaces the customer's open checkout and opens one at the discounted price", async () => {
    const { service, tx } = setup();

    const result = await service.checkout('u-1', { planId: 'monthly', gateway: 'BKASH', couponCode: 'EID20' });

    expect(tx.payment.updateMany).toHaveBeenCalledWith({ where: { userId: 'u-1', status: 'PENDING' }, data: { status: 'FAILED', failureReason: 'replaced' } });
    expect(tx.payment.create.mock.calls[0][0].data).toMatchObject({
      userId: 'u-1',
      planId: 'monthly',
      purpose: 'NEW',
      listPrice: '299.00',
      amount: '240.00',
      discountApplied: '59.00',
      couponId: 'c-1',
      referralDiscount: null,
      gateway: 'BKASH',
      status: 'PENDING',
    });
    expect(result).toMatchObject({ displayId: 'PAY-ABCD1234', amount: '240.00', discount: '59.00', next: { kind: 'instructions' } });
  });

  it('is a renewal on the same paid plan', async () => {
    const { service, tx } = setup({ found: null, sub: { ...FREE_SUB, planId: 'monthly', plan: { billingCycle: 'MONTHLY' }, currentPeriodEnd: new Date() } });
    await service.checkout('u-1', { planId: 'monthly', gateway: 'NAGAD' });
    expect(tx.payment.create.mock.calls[0][0].data).toMatchObject({ purpose: 'RENEWAL', amount: '299.00', couponId: null, discountApplied: null });
  });

  it('refuses a bad coupon with its reason, and opens nothing', async () => {
    const { service, tx } = setup({ found: coupon({ validUntil: new Date('2020-02-01T00:00:00.000Z') }) });
    const error = await service.checkout('u-1', { planId: 'monthly', gateway: 'BKASH', couponCode: 'OLD' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({ reason: 'EXPIRED' });
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it('refuses the free plan and a plan that is gone', async () => {
    const free = setup();
    free.prisma.subscriptionPlan.findUnique.mockResolvedValue({ ...MONTHLY, billingCycle: 'FREE' });
    await expect(free.service.checkout('u-1', { planId: 'free', gateway: 'BKASH' })).rejects.toBeInstanceOf(BadRequestException);

    const gone = setup();
    gone.prisma.subscriptionPlan.findUnique.mockResolvedValue({ ...MONTHLY, isActive: false });
    await expect(gone.service.checkout('u-1', { planId: 'monthly', gateway: 'BKASH' })).rejects.toBeInstanceOf(NotFoundException);
  });
});
