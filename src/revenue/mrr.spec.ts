import { computeMrr, PAID_SUBSCRIPTION_WHERE } from './mrr.js';

describe('computeMrr', () => {
  it('adds what each paying customer pays a month, a yearly price spread over twelve', async () => {
    const findMany = vi.fn().mockResolvedValue([
      // Locked at their last payment, below today's list price.
      { lockedPrice: 249, plan: { price: 299, billingCycle: 'MONTHLY' } },
      { lockedPrice: null, plan: { price: 2999, billingCycle: 'YEARLY' } },
    ]);
    await expect(computeMrr({ userSubscription: { findMany } } as never)).resolves.toBe(498.92);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: PAID_SUBSCRIPTION_WHERE }));
  });

  it('counts running and grace-day plans only, so a trial is not paid', () => {
    expect(PAID_SUBSCRIPTION_WHERE.status).toEqual({ in: ['ACTIVE', 'PAST_DUE'] });
  });
});
