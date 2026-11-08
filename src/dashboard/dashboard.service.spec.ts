import { DashboardService } from './dashboard.service.js';

const NOW = new Date('2026-10-02T06:00:00.000Z');

const setup = () => {
  const count = vi.fn().mockResolvedValue(0);
  const prisma = {
    user: { count: vi.fn().mockResolvedValue(10), findMany: vi.fn().mockResolvedValue([{ createdAt: new Date('2026-10-01T06:00:00.000Z') }]) },
    supportTicket: {
      count,
      findMany: vi.fn().mockResolvedValue([{ status: 'OPEN', createdAt: new Date('2026-10-02T00:00:00.000Z'), messages: [] }]),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    userSubscription: {
      groupBy: vi
        .fn()
        // Paid people, then every live account by plan.
        .mockResolvedValueOnce([{ planId: 'monthly', _count: 2 }])
        .mockResolvedValueOnce([
          { planId: 'monthly', _count: 2 },
          { planId: 'free', _count: 7 },
        ]),
    },
    subscriptionPlan: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'free', name: 'Free', price: 0, billingCycle: 'FREE' },
        { id: 'monthly', name: 'Monthly Pro', price: 299, billingCycle: 'MONTHLY' },
      ]),
    },
    payoutRequest: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 1540 }, _count: { _all: 2 } }) },
    payment: { count: vi.fn().mockResolvedValue(5) },
    suspiciousActivityFlag: { count: vi.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(1) },
    errorLog: { count: vi.fn().mockResolvedValueOnce(12).mockResolvedValueOnce(9) },
    backupRecord: { findFirst: vi.fn().mockResolvedValue(null) },
    auditLog: { findMany: vi.fn().mockResolvedValue([]) },
    featureRequest: { findMany: vi.fn().mockResolvedValue([]) },
    platformUser: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const analytics = { summary: vi.fn().mockResolvedValue({ activeLast30d: 6, totalAccounts: 10 }) };
  const revenue = {
    overview: vi.fn().mockResolvedValue({ mrr: 598, arr: 7176, mrrChangePct: 4.2 }),
    summary: vi.fn().mockResolvedValue({
      revenueTrend: [
        { month: '2026-08', amount: 100 },
        { month: '2026-09', amount: 150 },
        { month: '2026-10', amount: 20 },
      ],
    }),
  };
  const health = {
    status: vi.fn().mockResolvedValue({
      api: 'up',
      database: { ok: true, latencyMs: 3 },
      email: { configured: true, lastSendAt: null, lastSendOk: null },
      sms: { configured: false, lastSendAt: null, lastSendOk: null, balance: null },
      paymentGateway: { configured: false },
    }),
  };
  return { service: new DashboardService(prisma as never, analytics as never, revenue as never, health as never), prisma, revenue, health };
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DashboardService.summary', () => {
  it('gives a super admin every card', async () => {
    const { service } = setup();
    const summary = await service.summary({ id: 'admin-1', role: 'SUPER_ADMIN' }, '7d');

    expect(summary.attention).toEqual({
      payoutRequests: { count: 2, amount: '1540.00' },
      ticketsNoReply: { count: 1, oldestWaitingSince: new Date('2026-10-02T00:00:00.000Z') },
      failedPayments7d: { count: 5 },
      securityFlags: { open: 3, high: 1 },
      newErrors24h: { count: 12, high: 9 },
    });
    expect(summary).toMatchObject({ activeLast30d: 6, activePct: 60, mrr: 598, arr: 7176, mrrChangePct: 4.2, deletedLeftOut: 10 });
    // Two paid of 19 live accounts: nine with a subscription and ten (the
    // count mock) without one, who count as Free.
    expect(summary.paidUsers).toEqual({ total: 2, pctOfAccounts: 10.5, byPlan: [{ planId: 'monthly', planName: 'Monthly Pro', count: 2 }] });
    expect(summary.signupsPerDay).toHaveLength(7);
    expect(summary.revenueByMonth).toEqual([
      { month: '2026-08', amount: '100.00' },
      { month: '2026-09', amount: '150.00' },
    ]);
    expect(summary.revenueChangePct).toBe(50);
    expect(summary.revenueThisMonth).toBe('20.00');
    expect(summary.system).toMatchObject({ api: 'up', errors24h: { count: 12, high: 9 }, allWorking: false });
    expect(summary.support).toBeNull();
  });

  it('keeps money and system figures from a support admin, and gives them their own queue', async () => {
    const { service, revenue, health } = setup();
    const summary = await service.summary({ id: 'admin-2', role: 'SUPPORT_ADMIN' });

    expect(summary.mrr).toBeNull();
    expect(summary.paidUsers).toBeNull();
    expect(summary.system).toBeNull();
    expect(summary.attention.payoutRequests).toBeNull();
    expect(summary.attention.securityFlags).toBeNull();
    expect(summary.attention.ticketsNoReply).toMatchObject({ count: 1 });
    expect(summary.support).toMatchObject({ noReply: 1, assignedToYou: 0, queue: [] });
    expect(revenue.overview).not.toHaveBeenCalled();
    expect(health.status).not.toHaveBeenCalled();
  });

  it('gives a finance admin the money but no tickets or system', async () => {
    const { service } = setup();
    const summary = await service.summary({ id: 'admin-3', role: 'FINANCE_ADMIN' });
    expect(summary.mrr).toBe(598);
    expect(summary.attention.failedPayments7d).toEqual({ count: 5 });
    expect(summary.attention.ticketsNoReply).toBeNull();
    expect(summary.system).toBeNull();
  });

  it('names what each recent change was on, who made it and why, leaving sign-ins out', async () => {
    const { service, prisma } = setup();
    const at = new Date('2026-10-02T05:00:00.000Z');
    prisma.auditLog.findMany.mockResolvedValue([
      {
        id: 'l1',
        action: 'USER_SUSPENDED',
        entityType: 'User',
        entityId: 'u-abir',
        newValue: { reason: 'Spam invites' },
        createdAt: at,
        adminUser: { name: 'Imran', role: 'SUPPORT_ADMIN' },
      },
    ]);
    Object.assign(prisma.user, { findMany: vi.fn().mockResolvedValue([{ id: 'u-abir', name: 'Abir Hasan', createdAt: at }]) });
    const summary = await service.summary({ id: 'admin-1', role: 'SUPER_ADMIN' });
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { action: { notIn: ['ADMIN_LOGIN'] } } }));
    expect(summary.recentAuditLogs).toEqual([
      expect.objectContaining({ id: 'l1', entityLabel: 'Abir Hasan', adminName: 'Imran', adminRole: 'SUPPORT_ADMIN', reason: 'Spam invites' }),
    ]);
  });
});

describe('DashboardService.overview', () => {
  // NOW is 2 Oct 2026 12:00 in Dhaka.
  const withHistory = () => {
    const ctx = setup();
    const { prisma } = ctx;
    Object.assign(prisma, {
      userSession: { findMany: vi.fn().mockResolvedValue([{ userId: 'a' }, { userId: 'b' }, { userId: 'c' }]) },
      refund: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 10 } }) },
    });
    prisma.subscriptionPlan.findMany.mockResolvedValue([
      { id: 'free', name: 'Free', price: 0, billingCycle: 'FREE' },
      { id: 'monthly', name: 'Monthly Pro', price: 199, billingCycle: 'MONTHLY' },
      { id: 'yearly', name: 'Yearly Pro', price: 1920, billingCycle: 'YEARLY' },
    ]);
    Object.assign(prisma.payment, {
      findMany: vi
        .fn()
        // Who had paid: one monthly payer in late August, one yearly payer in March.
        .mockResolvedValueOnce([
          {
            userId: 'm1',
            platformUserId: null,
            planId: 'monthly',
            paidAt: new Date('2026-08-20T06:00:00.000Z'),
            createdAt: new Date('2026-08-20T06:00:00.000Z'),
          },
          { userId: 'y1', platformUserId: null, planId: 'yearly', paidAt: null, createdAt: new Date('2026-03-05T06:00:00.000Z') },
        ])
        // The revenue chart's payments.
        .mockResolvedValueOnce([
          { amount: 199, createdAt: new Date('2026-08-20T06:00:00.000Z'), refund: null },
          { amount: 199, createdAt: new Date('2026-08-25T06:00:00.000Z'), refund: { amount: 50, status: 'COMPLETED' } },
        ]),
      aggregate: vi
        .fn()
        .mockResolvedValueOnce({ _sum: { amount: 398 } })
        .mockResolvedValueOnce({ _sum: { amount: 0 } }),
    });
    return ctx;
  };

  it('counts a month gone by from what was paid then', async () => {
    const { service, prisma } = withHistory();
    prisma.user.count.mockResolvedValue(10);
    const overview = await service.overview({ id: 'admin-1', role: 'SUPER_ADMIN' }, { from: '2026-08-01', to: '2026-08-31' });

    expect(overview.range).toEqual({ from: '2026-08-01', to: '2026-08-31', kind: 'month', unit: 'day', isNow: false });
    expect(overview.signups.points).toHaveLength(31);
    expect(overview.active).toEqual({ count: 3, accounts: 10, pct: 30 });
    // On 31 August: the monthly payer (paid 20 Aug) and the yearly one.
    expect(overview.money?.paidUsers).toEqual({
      total: 2,
      pctOfAccounts: 20,
      byPlan: [
        { planId: 'monthly', planName: 'Monthly Pro', count: 1 },
        { planId: 'yearly', planName: 'Yearly Pro', count: 1 },
      ],
    });
    expect(overview.money?.mrr).toBe(359);
    // On 1 August only the yearly payer was paid up.
    expect(overview.money?.mrrChange).toEqual({ pct: 124.4, amount: 199, before: 160 });
    expect(overview.money?.accountsByPlan.map((plan) => plan.count)).toEqual([8, 1, 1]);
    expect(overview.money?.revenue.months.map((row) => row.month)).toEqual(['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08']);
    expect(overview.money?.revenue.months.at(-1)?.amount).toBe('348.00');
    expect(overview.money?.revenue).toMatchObject({ total: '388.00', previous: { from: '2026-07-01', to: '2026-07-31', total: '-10.00' } });
    // The live subscriptions are only read for a period that runs to today.
    expect(prisma.userSubscription.groupBy).not.toHaveBeenCalled();
  });

  it('counts the running month from the live subscriptions', async () => {
    const { service, prisma } = withHistory();
    Object.assign(prisma.userSubscription, { findMany: vi.fn().mockResolvedValue([{ lockedPrice: 199, plan: { price: 199, billingCycle: 'MONTHLY' } }]) });
    const overview = await service.overview({ id: 'admin-1', role: 'SUPER_ADMIN' }, { from: '2026-10-01', to: '2026-10-31' });
    expect(overview.range).toMatchObject({ to: '2026-10-02', isNow: true });
    expect(overview.money?.paidUsers.byPlan).toEqual([{ planId: 'monthly', planName: 'Monthly Pro', count: 2 }]);
    expect(overview.money?.mrr).toBe(199);
    expect(prisma.userSubscription.groupBy).toHaveBeenCalledTimes(2);
  });

  it('keeps the money from a support admin and refuses a backwards period', async () => {
    const { service } = withHistory();
    const overview = await service.overview({ id: 'admin-2', role: 'SUPPORT_ADMIN' }, { from: '2026-09-01', to: '2026-09-30' });
    expect(overview.money).toBeNull();
    expect(overview.system).toBeNull();
    await expect(service.overview({ id: 'admin-1', role: 'SUPER_ADMIN' }, { from: '2026-09-30', to: '2026-09-01' })).rejects.toThrow('on or before');
  });
});
