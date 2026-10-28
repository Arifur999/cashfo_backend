import { REFERRAL_DEFAULTS } from '../settings/referral-settings.js';
import { ReferralCommissionsService } from './referral-commissions.service.js';

// Paid just now, so the 7-day window is still running.
const PAID_AT = new Date();
const payment = { id: 'pay-1', userId: 'u-nusrat', planId: 'yearly', amount: '2700.00', paidAt: PAID_AT, status: 'SUCCESS' };

const setup = ({
  status = 'JOINED',
  referrerPlan = { status: 'ACTIVE', billingCycle: 'YEARLY' },
  referral = {} as Record<string, unknown>,
  settings = {},
} = {}) => {
  const row = {
    id: 'ref-1',
    referrerId: 'u-khaled',
    status,
    commissionRate: '20.00',
    commissionAmount: '540.00',
    paidAmount: '2700.00',
    ...referral,
    referredUser: { name: 'Nusrat Jahan' },
  };
  const tx = {
    referral: {
      findUnique: vi.fn().mockResolvedValue(row),
      findUniqueOrThrow: vi.fn().mockResolvedValue(row),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    subscriptionPlan: { findUnique: vi.fn().mockResolvedValue({ name: 'Yearly Pro' }) },
    $executeRaw: vi.fn().mockResolvedValue(0),
  };
  const settingsService = { getReferralSettings: vi.fn().mockResolvedValue({ ...REFERRAL_DEFAULTS, ...settings }) };
  const subscriptions = { ensure: vi.fn().mockResolvedValue({ status: referrerPlan.status, plan: { billingCycle: referrerPlan.billingCycle } }) };
  const notices = { bell: vi.fn().mockResolvedValue(true) };
  const service = new ReferralCommissionsService(
    {} as never,
    settingsService as never,
    subscriptions as never,
    { onPaid: vi.fn(), onRefunded: vi.fn() } as never,
    { register: vi.fn() } as never,
    notices as never,
  );
  return { service, tx, notices };
};

describe('ReferralCommissionsService.onFriendPaid', () => {
  it('turns a JOINED referral into a held commission and tells the referrer', async () => {
    const { service, tx, notices } = setup();
    await service.onFriendPaid(payment as never, tx as never);
    expect(tx.$executeRaw).toHaveBeenCalled();
    const update = tx.referral.updateMany.mock.calls[0][0] as { where: unknown; data: Record<string, { toString(): string } | string | Date> };
    expect(update.where).toEqual({ id: 'ref-1', status: 'JOINED' });
    expect(update.data.status).toBe('PENDING');
    expect(update.data.paymentId).toBe('pay-1');
    expect(update.data.commissionAmount.toString()).toBe('540');
    expect(update.data.commissionRate.toString()).toBe('20');
    expect(update.data.availableAt).toEqual(new Date(PAID_AT.getTime() + 7 * 86_400_000));
    expect(notices.bell).toHaveBeenCalledWith(
      'u-khaled',
      'REFERRAL',
      'referral:ref-1:pending',
      expect.objectContaining({ event: 'COMMISSION_PENDING', amount: '540.00', planName: 'Yearly Pro' }),
      tx,
    );
  });

  it('leaves alone a referral that is not JOINED (an old bonus, or a later payment)', async () => {
    const { service, tx } = setup({ status: 'AVAILABLE' });
    await service.onFriendPaid(payment as never, tx as never);
    expect(tx.referral.updateMany).not.toHaveBeenCalled();
  });

  it('earns nothing for a referrer on a free trial, and says what they missed', async () => {
    const { service, tx, notices } = setup({ referrerPlan: { status: 'TRIALING', billingCycle: 'YEARLY' } });
    await service.onFriendPaid(payment as never, tx as never);
    expect((tx.referral.updateMany.mock.calls[0][0] as { data: { status: string; cancelReason: string } }).data).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'REFERRER_NOT_ON_PAID_PLAN',
    });
    expect(notices.bell).toHaveBeenCalledWith('u-khaled', 'REFERRAL', 'referral:ref-1:missed', expect.objectContaining({ event: 'COMMISSION_MISSED' }), tx);
  });
});

describe('ReferralCommissionsService.onFriendRefunded', () => {
  it('cancels a commission still inside the window on a full refund', async () => {
    const { service, tx, notices } = setup({ status: 'PENDING', referral: { availableAt: new Date(Date.now() + 86_400_000) } });
    await service.onFriendRefunded(payment as never, tx as never, { amount: 2700, full: true });
    expect(tx.referral.updateMany).toHaveBeenCalledWith({
      where: { id: 'ref-1', status: 'PENDING' },
      data: expect.objectContaining({ status: 'CANCELLED', cancelReason: 'FRIEND_REFUNDED' }),
    });
    expect(notices.bell).toHaveBeenCalledWith(
      'u-khaled',
      'REFERRAL',
      'referral:ref-1:cancelled',
      expect.objectContaining({ event: 'COMMISSION_CANCELLED' }),
      tx,
    );
  });

  it('keeps an available commission (the window is over)', async () => {
    const { service, tx } = setup({ status: 'AVAILABLE', referral: { availableAt: new Date(Date.now() - 86_400_000) } });
    await service.onFriendRefunded(payment as never, tx as never, { amount: 2700, full: true });
    expect(tx.referral.updateMany).not.toHaveBeenCalled();
  });
});
