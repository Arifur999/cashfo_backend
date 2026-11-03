import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
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
  openCheckouts = 0,
  // The customer's open payment whose money they sent, and another payment
  // that already has the TrxID.
  sentOpen = null as { id: string } | null,
  usedReference = null as { id: string } | null,
} = {}) => {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    coupon: { findUniqueOrThrow: vi.fn().mockResolvedValue({ timesRedeemed: (found?.timesRedeemed as number) ?? 0 }) },
    payment: {
      count: vi.fn().mockResolvedValue(openCheckouts),
      findFirst: vi.fn((args: { where: Record<string, unknown> }) => Promise.resolve(args.where.submittedAt ? sentOpen : usedReference)),
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

  it("counts other people's open checkouts against a coupon's cap", async () => {
    const full = setup({ found: coupon({ maxRedemptions: 10, timesRedeemed: 8 }), openCheckouts: 2 });
    const error = await full.service.checkout('u-1', { planId: 'monthly', gateway: 'BKASH', couponCode: 'EID20' }).catch((e: unknown) => e);
    expect((error as BadRequestException).getResponse()).toMatchObject({ reason: 'USED_UP' });
    expect(full.tx.payment.create).not.toHaveBeenCalled();
    expect(full.tx.payment.count).toHaveBeenCalledWith({
      where: { couponId: 'c-1', status: 'PENDING', OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }], NOT: { userId: 'u-1' } },
    });

    const room = setup({ found: coupon({ maxRedemptions: 10, timesRedeemed: 8 }), openCheckouts: 1 });
    await room.service.checkout('u-1', { planId: 'monthly', gateway: 'BKASH', couponCode: 'EID20' });
    expect(room.tx.payment.create).toHaveBeenCalled();
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

describe('BillingService.checkout with the details of the money sent', () => {
  it('goes straight to checking: the number as digits, the TrxID in capitals, no end time', async () => {
    const { service, tx } = setup({ found: null });
    const result = await service.checkout('u-1', { planId: 'monthly', gateway: 'BKASH', payerAccount: '01711-482915', reference: '9kd7h2x4lm' });
    expect(tx.payment.create.mock.calls[0][0].data).toMatchObject({
      payerAccount: '01711482915',
      gatewayReferenceId: '9KD7H2X4LM',
      submittedAt: expect.any(Date),
      expiresAt: null,
    });
    expect(result).toMatchObject({ payerAccount: '01711482915', reference: '9KD7H2X4LM' });
  });

  it('opens nothing new while a payment the customer sent is being checked', async () => {
    const { service, tx } = setup({ found: null, sentOpen: { id: 'p-sent' } });
    const error = await service.checkout('u-1', { planId: 'monthly', gateway: 'BKASH' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({ reason: 'PAYMENT_BEING_CHECKED', paymentId: 'p-sent' });
    expect(tx.payment.updateMany).not.toHaveBeenCalled();
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it('refuses a TrxID already on another payment', async () => {
    const { service, tx } = setup({ found: null, usedReference: { id: 'p-other' } });
    const error = await service.checkout('u-1', { planId: 'monthly', gateway: 'NAGAD', payerAccount: '01711482915', reference: '7HX2K9QA' }).catch((e: unknown) => e);
    expect((error as ConflictException).getResponse()).toMatchObject({ reason: 'REFERENCE_USED' });
    expect(tx.payment.findFirst).toHaveBeenCalledWith({
      where: { gatewayReferenceId: { equals: '7HX2K9QA', mode: 'insensitive' }, status: { in: ['PENDING', 'SUCCESS', 'REFUNDED'] } },
      select: { id: true },
    });
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it('names the field to fix, and takes no details for an online payment', async () => {
    const { service, prisma } = setup({ found: null });
    const error = await service.checkout('u-1', { planId: 'monthly', gateway: 'BKASH', payerAccount: '0171', reference: '9KD7H2X4LM' }).catch((e: unknown) => e);
    expect((error as BadRequestException).getResponse()).toMatchObject({ field: 'payerAccount' });
    await expect(service.checkout('u-1', { planId: 'monthly', gateway: 'CARD', payerAccount: '01711482915', reference: '9KD7H2X4LM' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('BillingService.submitDetails', () => {
  it("fixes an open checkout's details and stops its clock", async () => {
    const { service, prisma, tx } = setup();
    const read = vi.spyOn(service, 'payment').mockResolvedValue({ id: 'p-1' } as never);
    await service.submitDetails('u-1', 'p-1', { gateway: 'BANK', payerAccount: ' Khaled Mahmud ', reference: 'beftn-2611-0042' });
    expect(tx.payment.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { not: 'p-1' } }) }));
    expect(tx.payment.updateMany).toHaveBeenCalledWith({
      where: { id: 'p-1', userId: 'u-1', status: 'PENDING', OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }] },
      data: { gateway: 'BANK', payerAccount: 'Khaled Mahmud', gatewayReferenceId: 'BEFTN-2611-0042', submittedAt: expect.any(Date), expiresAt: null },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith('u-1', 'p-1');
  });

  it('is a 404 for a checkout that is settled, lapsed or not theirs', async () => {
    const { service, tx } = setup();
    tx.payment.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.submitDetails('u-1', 'p-1', { gateway: 'BKASH', payerAccount: '01711482915', reference: '9KD7H2X4LM' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('BillingService.cancelCheckout', () => {
  it('cancels only a checkout whose money was not sent', async () => {
    const { service, prisma } = setup();
    const payment = prisma.payment as unknown as { updateMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
    payment.updateMany = vi.fn().mockResolvedValue({ count: 0 });
    payment.count = vi.fn().mockResolvedValue(1);
    await expect(service.cancelCheckout('u-1', 'p-1')).rejects.toBeInstanceOf(ConflictException);
    expect(payment.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'p-1', userId: 'u-1', status: 'PENDING', submittedAt: null } }));

    payment.count = vi.fn().mockResolvedValue(0);
    await expect(service.cancelCheckout('u-1', 'p-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
