import { RevenueService } from './revenue.service.js';

vi.mock('./mrr.js', () => ({ computeMrr: vi.fn().mockResolvedValue(299), PAID_SUBSCRIPTION_WHERE: {}, REVENUE_STATUSES: ['SUCCESS', 'REFUNDED'] }));

const NOW = new Date('2026-10-20T06:00:00.000Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

const payment = (userId: string, paidAt: string) => ({
  userId,
  platformUserId: null,
  planId: 'monthly',
  amount: 299,
  discountApplied: null,
  couponId: null,
  paidAt: new Date(paidAt),
  createdAt: new Date(paidAt),
  refund: null,
});

describe('RevenueService.overview', () => {
  it('says how many of the people who started paying this month a friend brought in', async () => {
    const prisma = {
      subscriptionPlan: { findMany: vi.fn().mockResolvedValue([{ id: 'monthly', name: 'Monthly Pro', billingCycle: 'MONTHLY', price: 299 }]) },
      // Two start this month; one has paid since September.
      payment: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            payment('u-new-1', '2026-10-05T06:00:00.000Z'),
            payment('u-new-2', '2026-10-12T06:00:00.000Z'),
            payment('u-old', '2026-09-25T06:00:00.000Z'),
            payment('u-old', '2026-10-15T06:00:00.000Z'),
          ]),
      },
      referral: { count: vi.fn().mockResolvedValue(1) },
    };
    const service = new RevenueService(prisma as never);
    vi.spyOn(service, 'churn').mockResolvedValue(null as never);

    const overview = await service.overview();

    expect(overview.paidPeople).toEqual({ now: 3, joinedThisMonth: 2, joinedFromReferral: 1, leftThisMonth: 0 });
    expect(prisma.referral.count).toHaveBeenCalledWith({ where: { referredUserId: { in: ['u-new-1', 'u-new-2'] } } });
  });
});
