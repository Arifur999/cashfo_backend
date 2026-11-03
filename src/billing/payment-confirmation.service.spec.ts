import { ConflictException, NotFoundException } from '@nestjs/common';
import { PaymentConfirmationService } from './payment-confirmation.service.js';

const PAID_AT = new Date('2026-10-27T06:00:00.000Z');
const PERIOD_END = new Date('2026-11-27T06:00:00.000Z');
const plan = { id: 'monthly', name: 'Monthly Pro', price: '299.00', billingCycle: 'MONTHLY' };

const pendingRow = (over: Record<string, unknown> = {}) => ({
  id: 'pay-1',
  userId: 'u-nadia',
  platformUserId: null,
  planId: 'monthly',
  amount: '239.00',
  listPrice: '299.00',
  referralDiscount: null,
  couponId: 'c-1',
  status: 'SUCCESS',
  plan,
  invoice: null,
  ...over,
});

const setup = ({ claimed = 1, current = 'PENDING', row = pendingRow() as Record<string, unknown> } = {}) => {
  const tx = {
    payment: {
      updateMany: vi.fn().mockResolvedValue({ count: claimed }),
      findUnique: vi.fn().mockResolvedValue(current ? { status: current } : null),
      findUniqueOrThrow: vi.fn().mockResolvedValue(row),
      update: vi.fn().mockResolvedValue({}),
    },
    coupon: { findUnique: vi.fn().mockResolvedValue({ id: 'c-1', code: 'EID20' }), update: vi.fn().mockResolvedValue({}) },
    couponRedemption: { create: vi.fn().mockResolvedValue({}) },
    user: { findUnique: vi.fn().mockResolvedValue({ name: 'Nadia', email: 'nadia@example.com' }) },
    platformUser: { findUnique: vi.fn() },
    invoice: {
      create: vi.fn((args: { data: Record<string, unknown> }) => Promise.resolve({ id: 'inv-1', ...args.data })),
      count: vi.fn().mockResolvedValue(41),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    $executeRaw: vi.fn().mockResolvedValue(0),
  };
  const prisma = { $transaction: vi.fn((run: (client: typeof tx) => Promise<unknown>) => run(tx)) };
  const subscriptions = {
    activateFromPayment: vi.fn().mockResolvedValue({
      subscription: { planId: 'monthly', status: 'ACTIVE', currentPeriodStart: PAID_AT, currentPeriodEnd: PERIOD_END, plan },
      periodStart: PAID_AT,
      periodEnd: PERIOD_END,
    }),
  };
  const hooks = { runPaid: vi.fn().mockResolvedValue([]), afterCommit: vi.fn() };
  const notices = { paid: vi.fn().mockResolvedValue(undefined), bell: vi.fn().mockResolvedValue(true), failed: vi.fn().mockResolvedValue(undefined) };
  const settings = { getCached: vi.fn().mockResolvedValue({ billingCheckoutHours: 48 }) };
  const service = new PaymentConfirmationService(prisma as never, subscriptions as never, hooks as never, notices as never, settings as never);
  return { service, tx, subscriptions, hooks, notices };
};

describe('PaymentConfirmationService.markPaid', () => {
  it('claims only a PENDING payment and starts the plan, invoice, coupon use and audit in one go', async () => {
    const { service, tx, subscriptions, hooks, notices } = setup();

    const result = await service.markPaid(
      'pay-1',
      { reference: 'TRX123', paidAt: PAID_AT, payerAccount: '01711000000' },
      { adminId: 'admin-1', ipAddress: '203.0.113.9' },
    );

    expect(tx.payment.updateMany).toHaveBeenCalledWith({
      where: { id: 'pay-1', status: 'PENDING' },
      data: expect.objectContaining({ status: 'SUCCESS', paidAt: PAID_AT, gatewayReferenceId: 'TRX123', payerAccount: '01711000000', markedPaidBy: 'admin-1' }),
    });
    expect(subscriptions.activateFromPayment).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ userId: 'u-nadia', planId: 'monthly' }),
      plan,
      PAID_AT,
      'admin-1',
    );
    expect(tx.payment.update).toHaveBeenCalledWith({ where: { id: 'pay-1' }, data: { periodStart: PAID_AT, periodEnd: PERIOD_END } });
    expect(tx.couponRedemption.create).toHaveBeenCalledWith({
      data: { couponId: 'c-1', userId: 'u-nadia', platformUserId: null, planId: 'monthly', paymentId: 'pay-1' },
    });
    expect(tx.coupon.update).toHaveBeenCalledWith({ where: { id: 'c-1' }, data: { timesRedeemed: { increment: 1 } } });
    expect(tx.invoice.create.mock.calls[0][0].data).toMatchObject({
      paymentId: 'pay-1',
      invoiceNumber: `INV-${new Date().getFullYear()}-000042`,
      issuedTo: 'Nadia <nadia@example.com>',
      lineItems: [
        { description: 'Monthly Pro subscription', amount: 299 },
        { description: 'Coupon EID20', amount: -60 },
      ],
    });
    expect(hooks.runPaid).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({
      adminUserId: 'admin-1',
      action: 'PAYMENT_MARKED_PAID',
      entityId: 'pay-1',
      ipAddress: '203.0.113.9',
    });
    expect(notices.paid).toHaveBeenCalledTimes(1);
    expect(result.subscription).toMatchObject({ planId: 'monthly', status: 'ACTIVE', currentPeriodEnd: PERIOD_END });
  });

  it('is idempotent: a second press finds the payment already paid and changes nothing', async () => {
    const { service, subscriptions, tx, notices } = setup({ claimed: 0, current: 'SUCCESS' });

    await expect(service.markPaid('pay-1', { reference: 'TRX123' }, { adminId: 'admin-1' })).rejects.toBeInstanceOf(ConflictException);
    expect(subscriptions.activateFromPayment).not.toHaveBeenCalled();
    expect(tx.invoice.create).not.toHaveBeenCalled();
    expect(notices.paid).not.toHaveBeenCalled();
  });

  it('answers 404 for a payment that does not exist', async () => {
    const { service } = setup({ claimed: 0, current: '' });
    await expect(service.markPaid('nope', { reference: 'TRX' }, { adminId: 'admin-1' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('confirms a legacy sandbox payment without touching any plan, and a webhook writes no audit', async () => {
    const { service, subscriptions, tx } = setup({
      row: pendingRow({ userId: null, platformUserId: 'p-1', couponId: null, listPrice: null, amount: '299.00' }),
    });
    tx.platformUser.findUnique.mockResolvedValue({ name: 'Old Sandbox', email: 'old@example.com' });

    await service.markPaid('pay-1', { reference: 'TRX' }, null);

    expect(subscriptions.activateFromPayment).not.toHaveBeenCalled();
    expect(tx.invoice.create.mock.calls[0][0].data).toMatchObject({
      issuedTo: 'Old Sandbox <old@example.com>',
      lineItems: [{ description: 'Monthly Pro subscription', amount: 299 }],
    });
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('refuses a payment date in the future', async () => {
    const { service } = setup();
    await expect(service.markPaid('pay-1', { reference: 'TRX', paidAt: new Date(Date.now() + 24 * 60 * 60 * 1000) }, { adminId: 'a' })).rejects.toThrow(
      /future/,
    );
  });
});

describe('PaymentConfirmationService.markFailed', () => {
  it('fails only a PENDING payment, audits it and tells the customer', async () => {
    const { service, tx, notices } = setup({ row: pendingRow({ status: 'FAILED' }) });

    await service.markFailed('pay-1', 'Money never arrived', { adminId: 'admin-1' });

    expect(tx.payment.updateMany).toHaveBeenCalledWith({
      where: { id: 'pay-1', status: 'PENDING' },
      data: { status: 'FAILED', failureReason: 'Money never arrived' },
    });
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'PAYMENT_MARKED_FAILED' });
    expect(notices.failed).toHaveBeenCalledWith(expect.objectContaining({ id: 'pay-1', userId: 'u-nadia' }), expect.any(String), expect.anything());
  });

  it('refuses a payment that is no longer pending', async () => {
    const { service } = setup({ claimed: 0, current: 'SUCCESS' });
    await expect(service.markFailed('pay-1', 'Money never arrived', { adminId: 'a' })).rejects.toBeInstanceOf(ConflictException);
  });
});

describe("PaymentConfirmationService keeps the customer's details", () => {
  it('Mark paid without a payer number keeps the one the customer sent', async () => {
    const { service, tx } = setup();
    await service.markPaid('pay-1', { reference: '9KD7H2X4LM', paidAt: PAID_AT, payerAccount: null }, { adminId: 'admin-1' });
    expect(tx.payment.updateMany.mock.calls[0][0].data.payerAccount).toBeUndefined();
  });
});

describe('PaymentConfirmationService.reopen', () => {
  it('opens a failed payment again: with the clock, or with none once its money was sent', async () => {
    const unsent = setup({ current: 'FAILED' });
    unsent.tx.payment.findUnique.mockResolvedValue({ status: 'FAILED', userId: 'u-nadia', submittedAt: null });
    (unsent.tx.payment as Record<string, unknown>).count = vi.fn().mockResolvedValue(0);
    await unsent.service.reopen('pay-1', { adminId: 'admin-1' });
    expect(unsent.tx.payment.updateMany.mock.calls[0][0].data.expiresAt).toBeInstanceOf(Date);

    const sent = setup({ current: 'FAILED' });
    sent.tx.payment.findUnique.mockResolvedValue({ status: 'FAILED', userId: 'u-nadia', submittedAt: PAID_AT });
    (sent.tx.payment as Record<string, unknown>).count = vi.fn().mockResolvedValue(0);
    await sent.service.reopen('pay-1', { adminId: 'admin-1' });
    expect(sent.tx.payment.updateMany.mock.calls[0][0].data.expiresAt).toBeNull();
  });

  it("refuses while the customer's other payment is being checked, and replaces nothing", async () => {
    const { service, tx } = setup({ current: 'FAILED' });
    tx.payment.findUnique.mockResolvedValue({ status: 'FAILED', userId: 'u-nadia', submittedAt: null });
    (tx.payment as Record<string, unknown>).count = vi.fn().mockResolvedValue(1);
    await expect(service.reopen('pay-1', { adminId: 'admin-1' })).rejects.toThrow('another payment being checked');
    expect(tx.payment.updateMany).not.toHaveBeenCalled();
  });
});
