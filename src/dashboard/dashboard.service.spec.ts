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

  it("names what each recent change was on, who made it and why, leaving sign-ins out", async () => {
    const { service, prisma } = setup();
    const at = new Date('2026-10-02T05:00:00.000Z');
    prisma.auditLog.findMany.mockResolvedValue([
      { id: 'l1', action: 'USER_SUSPENDED', entityType: 'User', entityId: 'u-abir', newValue: { reason: 'Spam invites' }, createdAt: at, adminUser: { name: 'Imran', role: 'SUPPORT_ADMIN' } },
    ]);
    Object.assign(prisma.user, { findMany: vi.fn().mockResolvedValue([{ id: 'u-abir', name: 'Abir Hasan', createdAt: at }]) });
    const summary = await service.summary({ id: 'admin-1', role: 'SUPER_ADMIN' });
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { action: { notIn: ['ADMIN_LOGIN'] } } }));
    expect(summary.recentAuditLogs).toEqual([
      expect.objectContaining({ id: 'l1', entityLabel: 'Abir Hasan', adminName: 'Imran', adminRole: 'SUPPORT_ADMIN', reason: 'Spam invites' }),
    ]);
  });
});
