import { REFERRAL_DEFAULTS } from '../settings/referral-settings.js';
import { ReferralCommissionsService } from './referral-commissions.service.js';

// Paid just now, so the 7-day window is still running.
const PAID_AT = new Date();
const payment = { id: 'pay-1', userId: 'u-nusrat', planId: 'yearly', amount: '1719.00', paidAt: PAID_AT, status: 'SUCCESS' };

const setup = ({
  referral = { status: 'JOINED', cancelReason: null } as Record<string, unknown> | null,
  referrerPlan = { status: 'ACTIVE', billingCycle: 'YEARLY' },
  earlier = 0,
  existing = null as unknown,
  commission = {} as Record<string, unknown>,
  settings = {},
} = {}) => {
  const created: Record<string, unknown>[] = [];
  const line = {
    id: 'com-1',
    referralId: 'ref-1',
    referrerId: 'u-khaled',
    status: 'ON_HOLD',
    paidAmount: '1719.00',
    rate: '20.00',
    amount: '343.80',
    availableAt: new Date(Date.now() + 86_400_000),
    referral: { referredUser: { name: 'Nusrat Jahan' } },
    ...commission,
  };
  const tx = {
    referral: {
      findUnique: vi.fn().mockResolvedValue(referral && { id: 'ref-1', referrerId: 'u-khaled', referredUser: { name: 'Nusrat Jahan' }, ...referral }),
    },
    referralCommission: {
      findUnique: vi.fn().mockResolvedValueOnce(existing).mockResolvedValue(line),
      findUniqueOrThrow: vi.fn().mockResolvedValue(line),
      count: vi.fn().mockResolvedValue(earlier),
      create: vi.fn((args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        return Promise.resolve({ id: 'com-1', ...args.data });
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    subscriptionPlan: { findUnique: vi.fn().mockResolvedValue({ name: 'Yearly Pro' }) },
    $executeRaw: vi.fn().mockResolvedValue(0),
  };
  const settingsService = { getReferralSettings: vi.fn().mockResolvedValue({ ...REFERRAL_DEFAULTS, ...settings }) };
  const subscriptions = { ensure: vi.fn().mockResolvedValue({ status: referrerPlan.status, plan: { billingCycle: referrerPlan.billingCycle } }) };
  const email = vi.fn();
  const notices = { bell: vi.fn().mockResolvedValue(true), commissionEarned: vi.fn().mockResolvedValue(email) };
  const service = new ReferralCommissionsService(
    {} as never,
    settingsService as never,
    subscriptions as never,
    { onPaid: vi.fn(), onRefunded: vi.fn() } as never,
    { register: vi.fn() } as never,
    notices as never,
  );
  return { service, tx, notices, created, email };
};

describe('ReferralCommissionsService.onFriendPaid', () => {
  it('holds a 20% share of the first payment and leaves the email for after the commit', async () => {
    const { service, tx, notices, created, email } = setup();
    const after = await service.onFriendPaid(payment as never, tx as never);
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(created).toHaveLength(1);
    const data = created[0] as Record<string, { toString(): string } | string | Date>;
    expect(data).toMatchObject({ referralId: 'ref-1', referrerId: 'u-khaled', paymentId: 'pay-1', kind: 'FIRST', status: 'ON_HOLD' });
    expect(data.amount.toString()).toBe('343.8');
    expect(data.rate.toString()).toBe('20');
    expect(data.availableAt).toEqual(new Date(PAID_AT.getTime() + 7 * 86_400_000));
    expect(notices.commissionEarned).toHaveBeenCalledWith(
      'u-khaled',
      expect.objectContaining({ id: 'com-1', renewal: false }),
      'Nusrat Jahan',
      expect.objectContaining({ commissionId: 'com-1', amount: '343.80', planName: 'Yearly Pro' }),
      tx,
    );
    expect(after).toBe(email);
  });

  it('earns on a renewal too', async () => {
    const { service, tx, created } = setup({ earlier: 2 });
    await service.onFriendPaid(payment as never, tx as never);
    expect(created[0]).toMatchObject({ kind: 'RENEWAL', status: 'ON_HOLD' });
  });

  it('still earns on the renewals of a friend whose first payment was refunded before v9', async () => {
    const { service, tx, created } = setup({ referral: { status: 'CANCELLED', cancelReason: 'FRIEND_REFUNDED' }, earlier: 1 });
    await service.onFriendPaid(payment as never, tx as never);
    expect(created).toHaveLength(1);
  });

  it('earns nothing for a blocked sign-up, a payment already counted, or someone nobody invited', async () => {
    for (const blocked of ['SELF_REFERRAL', 'MONTHLY_LIMIT']) {
      const { service, tx } = setup({ referral: { status: 'CANCELLED', cancelReason: blocked } });
      await service.onFriendPaid(payment as never, tx as never);
      expect(tx.referralCommission.create).not.toHaveBeenCalled();
    }
    const again = setup({ existing: { id: 'com-0' } });
    await again.service.onFriendPaid(payment as never, again.tx as never);
    expect(again.tx.referralCommission.create).not.toHaveBeenCalled();
    const nobody = setup({ referral: null });
    await nobody.service.onFriendPaid(payment as never, nobody.tx as never);
    expect(nobody.tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('records a missed commission for a referrer on a free trial, and says so', async () => {
    const { service, tx, notices, created } = setup({ referrerPlan: { status: 'TRIALING', billingCycle: 'YEARLY' } });
    const after = await service.onFriendPaid(payment as never, tx as never);
    expect(created[0]).toMatchObject({ status: 'CANCELLED', cancelReason: 'REFERRER_NOT_ON_PAID_PLAN' });
    expect(notices.bell).toHaveBeenCalledWith('u-khaled', 'REFERRAL', 'commission:com-1:missed', expect.objectContaining({ event: 'COMMISSION_MISSED' }), tx);
    expect(notices.commissionEarned).not.toHaveBeenCalled();
    expect(after).toBeUndefined();
  });
});

describe('ReferralCommissionsService.onFriendRefunded', () => {
  it('reverses a commission still inside the window on a full refund', async () => {
    const { service, tx, notices } = setup({ existing: { id: 'com-1', referrerId: 'u-khaled' } });
    await service.onFriendRefunded(payment as never, tx as never, { amount: 1719, full: true });
    expect(tx.referralCommission.updateMany).toHaveBeenCalledWith({
      where: { id: 'com-1', status: 'ON_HOLD' },
      data: expect.objectContaining({ status: 'REVERSED', cancelReason: 'FRIEND_REFUNDED' }),
    });
    expect(notices.bell).toHaveBeenCalledWith(
      'u-khaled',
      'REFERRAL',
      'commission:com-1:cancelled',
      expect.objectContaining({ event: 'COMMISSION_CANCELLED' }),
      tx,
    );
  });

  it('keeps a commission on what was kept after a partial refund', async () => {
    const { service, tx } = setup({ existing: { id: 'com-1', referrerId: 'u-khaled' } });
    await service.onFriendRefunded(payment as never, tx as never, { amount: 719, full: false });
    expect(String((tx.referralCommission.updateMany.mock.calls[0][0] as { data: { amount: unknown } }).data.amount)).toBe('200');
  });

  it('keeps an available commission (the window is over)', async () => {
    const { service, tx } = setup({
      existing: { id: 'com-1', referrerId: 'u-khaled' },
      commission: { status: 'AVAILABLE', availableAt: new Date(Date.now() - 86_400_000) },
    });
    await service.onFriendRefunded(payment as never, tx as never, { amount: 1719, full: true });
    expect(tx.referralCommission.updateMany).not.toHaveBeenCalled();
  });
});
