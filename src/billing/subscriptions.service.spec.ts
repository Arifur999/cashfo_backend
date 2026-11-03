import { SubscriptionsService } from './subscriptions.service.js';

const NOW = new Date('2026-10-27T06:00:00.000Z');
const daysFromNow = (days: number) => new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000);
const FREE = { id: 'free', name: 'Free', slug: 'free', billingCycle: 'FREE', price: '0.00' };
const MONTHLY = { id: 'monthly', name: 'Monthly Pro', slug: 'monthly-pro', billingCycle: 'MONTHLY', price: '299.00' };

const subscription = (over: Record<string, unknown> = {}) => ({
  id: 'sub-1',
  userId: 'u-1',
  planId: 'monthly',
  plan: MONTHLY,
  status: 'ACTIVE',
  trialEndsAt: null,
  currentPeriodStart: daysFromNow(-30),
  currentPeriodEnd: daysFromNow(10),
  cancelAtPeriodEnd: false,
  lockedPrice: '299.00',
  trialUsedAt: null,
  ...over,
});

const setup = ({ before = { planId: 'free' } as { planId: string } | null, current = subscription() as Record<string, unknown> | null, claimed = 1 } = {}) => {
  const tx = {
    userSubscription: {
      findUnique: vi.fn((args: { include?: unknown }) => Promise.resolve(args.include ? current : before)),
      upsert: vi.fn((args: { update: Record<string, unknown> }) => Promise.resolve({ ...subscription(), ...args.update })),
      updateMany: vi.fn().mockResolvedValue({ count: claimed }),
    },
    business: { updateMany: vi.fn().mockResolvedValue({ count: 2 }), findFirst: vi.fn().mockResolvedValue({ planId: 'free' }) },
    planChangeLog: { create: vi.fn().mockResolvedValue({}) },
    subscriptionPlan: { findUnique: vi.fn().mockResolvedValue(FREE), findFirst: vi.fn() },
    payment: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() },
  };
  const prisma = { ...tx, $transaction: vi.fn((run: (client: typeof tx) => Promise<unknown>) => run(tx)) };
  const settings = { getCached: vi.fn().mockResolvedValue({ billingGraceDays: 3 }) };
  const notices = { bell: vi.fn().mockResolvedValue(true), plan: vi.fn().mockResolvedValue(undefined) };
  return { service: new SubscriptionsService(prisma as never, settings as never, notices as never), tx, notices };
};

describe('SubscriptionsService.applyPlan', () => {
  it("sets the plan, mirrors it onto the customer's own workspaces and logs the change", async () => {
    const { service, tx } = setup();

    await service.applyPlan(tx as never, 'u-1', 'monthly', { changedBy: 'admin-1', reason: 'Gift', fields: { status: 'ACTIVE' } });

    expect(tx.userSubscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u-1' }, update: { planId: 'monthly', status: 'ACTIVE' } }),
    );
    expect(tx.business.updateMany).toHaveBeenCalledWith({ where: { ownerId: 'u-1', deletedAt: null, type: { not: 'GROUP' } }, data: { planId: 'monthly' } });
    expect(tx.planChangeLog.create).toHaveBeenCalledWith({
      data: { userId: 'u-1', fromPlanId: 'free', toPlanId: 'monthly', changedBy: 'admin-1', reason: 'Gift' },
    });
  });

  it('logs nothing when the plan stays the same', async () => {
    const { service, tx } = setup({ before: { planId: 'monthly' } });
    await service.applyPlan(tx as never, 'u-1', 'monthly', { changedBy: 'SYSTEM' });
    expect(tx.planChangeLog.create).not.toHaveBeenCalled();
  });
});

describe('SubscriptionsService.activateFromPayment', () => {
  it('adds an early renewal to the end of the running period and locks the price paid', async () => {
    const { service, tx } = setup();

    const { periodStart, periodEnd } = await service.activateFromPayment(
      tx as never,
      { userId: 'u-1', planId: 'monthly', listPrice: '299.00' as never },
      MONTHLY as never,
      NOW,
      'admin-1',
    );

    expect(periodStart).toEqual(daysFromNow(10));
    expect(periodEnd).toEqual(new Date('2026-12-06T06:00:00.000Z'));
    expect(tx.userSubscription.upsert.mock.calls[0][0].update).toMatchObject({
      status: 'ACTIVE',
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
      trialEndsAt: null,
      lockedPrice: '299.00',
    });
  });

  it('starts a first purchase at the payment', async () => {
    const { service, tx } = setup({ current: subscription({ planId: 'free', plan: FREE, currentPeriodEnd: null }) });
    const { periodStart, periodEnd } = await service.activateFromPayment(
      tx as never,
      { userId: 'u-1', planId: 'monthly', listPrice: null },
      MONTHLY as never,
      NOW,
      'SYSTEM',
    );
    expect(periodStart).toEqual(NOW);
    expect(periodEnd).toEqual(new Date('2026-11-27T06:00:00.000Z'));
  });
});

describe('SubscriptionsService.sweepUser (expiry)', () => {
  it('moves an unpaid ended period to PAST_DUE and rings the bell once', async () => {
    const { service, tx, notices } = setup({ current: subscription({ currentPeriodEnd: daysFromNow(-1) }) });

    await service.sweepUser('u-1', NOW);

    expect(tx.userSubscription.updateMany).toHaveBeenCalledWith({
      where: { id: 'sub-1', status: 'ACTIVE', currentPeriodEnd: daysFromNow(-1), trialEndsAt: null, planId: 'monthly' },
      data: { status: 'PAST_DUE' },
    });
    expect(notices.plan).toHaveBeenCalledWith('u-1', expect.objectContaining({ key: 'plan:sub-1:past-due:2026-10-26' }), null);
    expect(tx.business.updateMany).not.toHaveBeenCalled();
  });

  it('drops a plan past its grace days back to free and emails the customer', async () => {
    const { service, tx, notices } = setup({ current: subscription({ status: 'PAST_DUE', currentPeriodEnd: daysFromNow(-4) }), before: { planId: 'monthly' } });

    await service.sweepUser('u-1', NOW);

    expect(tx.userSubscription.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'EXPIRED' } }));
    expect(tx.business.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { planId: 'free' } }));
    expect(tx.planChangeLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ fromPlanId: 'monthly', toPlanId: 'free', changedBy: 'SYSTEM', reason: 'expired' }),
    });
    expect(notices.plan).toHaveBeenCalledWith(
      'u-1',
      expect.objectContaining({ key: 'plan:sub-1:ended:2026-10-23' }),
      expect.objectContaining({ kind: 'ENDED', trial: false }),
    );
  });

  it('does nothing more when another server made the move first', async () => {
    const { service, tx, notices } = setup({ current: subscription({ status: 'PAST_DUE', currentPeriodEnd: daysFromNow(-4) }), claimed: 0 });
    await service.sweepUser('u-1', NOW);
    expect(tx.business.updateMany).not.toHaveBeenCalled();
    expect(notices.plan).not.toHaveBeenCalled();
  });

  it('warns three days ahead, by email unless the customer already asked to stop', async () => {
    const ending = setup({ current: subscription({ currentPeriodEnd: daysFromNow(2) }) });
    await ending.service.sweepUser('u-1', NOW);
    expect(ending.notices.plan).toHaveBeenCalledWith(
      'u-1',
      expect.objectContaining({ key: 'plan:sub-1:ending:2026-10-29' }),
      expect.objectContaining({ kind: 'ENDING' }),
    );

    const stopping = setup({ current: subscription({ currentPeriodEnd: daysFromNow(2), cancelAtPeriodEnd: true }) });
    await stopping.service.sweepUser('u-1', NOW);
    expect(stopping.notices.plan).toHaveBeenCalledWith('u-1', expect.anything(), null);
  });

  it('fails lapsed checkouts as expired and tells their customers', async () => {
    const { service, tx, notices } = setup({ current: null });
    tx.payment.findMany.mockResolvedValue([{ id: 'pay-9', userId: 'u-1', amount: '299.00', plan: { name: 'Monthly Pro' } }]);
    tx.payment.updateMany.mockResolvedValue({ count: 1 });

    await service.sweepUser('u-1', NOW);

    expect(tx.payment.findMany.mock.calls[0][0].where).toEqual({ status: 'PENDING', expiresAt: { lte: NOW }, submittedAt: null, userId: 'u-1' });
    expect(tx.payment.updateMany).toHaveBeenCalledWith({ where: { id: 'pay-9', status: 'PENDING' }, data: { status: 'FAILED', failureReason: 'expired' } });
    expect(notices.bell).toHaveBeenCalledWith('u-1', expect.objectContaining({ key: 'payment:pay-9:expired' }));
  });
});
