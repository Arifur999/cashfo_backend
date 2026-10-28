import { PaymentGateway, PaymentStatus } from '@prisma/client';
import { EXPORT_ROW_CAP } from './payments-export.js';
import { PaymentsService } from './payments.service.js';

const payment = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  userId: 'u-1' as string | null,
  platformUserId: null as string | null,
  couponId: null,
  planId: 'monthly',
  createdAt: new Date('2026-10-01T04:14:00.000Z'),
  purpose: 'NEW',
  gateway: PaymentGateway.BKASH,
  status: PaymentStatus.SUCCESS,
  listPrice: '299.00',
  discountApplied: null,
  amount: '299.00',
  currency: 'BDT',
  gatewayReferenceId: 'TRX1',
  paidAt: new Date('2026-10-01T04:15:00.000Z'),
  plan: { id: 'monthly', name: 'Monthly Pro', slug: 'monthly-pro' },
  invoice: null,
  refund: null,
  ...overrides,
});

const setup = (rows: ReturnType<typeof payment>[] = []) => {
  const prisma = {
    payment: {
      findMany: vi.fn((args: { select?: Record<string, unknown> }) => Promise.resolve(args.select && 'gateway' in args.select ? rows : [])),
      findUnique: vi.fn(),
    },
    user: { findMany: vi.fn().mockResolvedValue([{ id: 'u-1', name: 'Mahbub Alam', email: 'mahbub@example.com' }]) },
    platformUser: { findMany: vi.fn().mockResolvedValue([]) },
    coupon: { findMany: vi.fn().mockResolvedValue([]) },
    userSubscription: { findUnique: vi.fn().mockResolvedValue(null) },
    supportTicket: { findMany: vi.fn().mockResolvedValue([{ id: 't-1', subject: 'Charged twice', status: 'OPEN', priority: 'HIGH', category: 'BILLING' }]) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  return { service: new PaymentsService(prisma as never), prisma };
};

describe('PaymentsService.exportCsv', () => {
  it('reads every row under the same filters as the list, status included, and ignores the page', async () => {
    const { service, prisma } = setup([payment('3f2a1c9b-1'), payment('3f2a1c9b-2')]);

    const file = await service.exportCsv({ status: PaymentStatus.SUCCESS, gateway: PaymentGateway.BKASH, page: 3, limit: 10 }, 'admin-1', '10.0.0.1');

    const query = prisma.payment.findMany.mock.calls[0][0] as unknown as { where: unknown; take: number; skip?: number };
    expect(query.where).toEqual({ gateway: PaymentGateway.BKASH, status: PaymentStatus.SUCCESS });
    expect(query.take).toBe(EXPORT_ROW_CAP + 1);
    expect(query.skip).toBeUndefined();
    expect(file).toMatchObject({ rows: 2, truncated: false });
    expect(file.fileName).toMatch(/^payments-\d{4}-\d{2}-\d{2}\.csv$/);

    const csv = file.data.toString('utf8');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).trimEnd().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^Payment,Date \(Dhaka\),Customer,Email,/);
    expect(lines[1]).toContain('PAY-3F2A1C9B,2026-10-01 10:14,Mahbub Alam,mahbub@example.com,Monthly Pro');
  });

  it('audits the export with its filters and row count', async () => {
    const { service, prisma } = setup([payment('a')]);

    await service.exportCsv({ planId: 'monthly', page: 1 }, 'admin-1', '10.0.0.1');

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        adminUserId: 'admin-1',
        action: 'PAYMENTS_EXPORTED',
        entityType: 'Payment',
        newValue: { filters: { planId: 'monthly' }, rows: 1, truncated: false },
        ipAddress: '10.0.0.1',
      },
    });
  });

  it('stops at the cap and says it was cut short', async () => {
    const many = Array.from({ length: EXPORT_ROW_CAP + 1 }, (_, index) => payment(`p-${index}`));
    const { service } = setup(many);

    const file = await service.exportCsv({}, 'admin-1');

    expect(file).toMatchObject({ rows: EXPORT_ROW_CAP, truncated: true });
  });
});

describe('PaymentsService.getById relatedTickets', () => {
  it("reads the payer's billing tickets within 14 days either side, newest first, at most 10", async () => {
    const { service, prisma } = setup();
    prisma.payment.findUnique.mockResolvedValue(payment('p-1'));

    const result = await service.getById('p-1');

    expect(prisma.supportTicket.findMany).toHaveBeenCalledWith({
      where: {
        category: 'BILLING',
        platformUserId: 'u-1',
        createdAt: { gte: new Date('2026-09-17T04:14:00.000Z'), lte: new Date('2026-10-15T04:14:00.000Z') },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 10,
      select: { id: true, subject: true, status: true, priority: true, category: true, createdAt: true },
    });
    expect(result.relatedTickets).toHaveLength(1);
  });

  it("uses a legacy payment's PlatformUser, and has none without a payer", async () => {
    const { service, prisma } = setup();
    prisma.payment.findUnique.mockResolvedValueOnce(payment('p-1', { userId: null, platformUserId: 'legacy-1' }));
    await service.getById('p-1');
    expect(prisma.supportTicket.findMany.mock.calls[0][0]).toMatchObject({ where: { platformUserId: 'legacy-1' } });

    prisma.payment.findUnique.mockResolvedValueOnce(payment('p-2', { userId: null, platformUserId: null }));
    const orphan = await service.getById('p-2');
    expect(orphan.relatedTickets).toEqual([]);
    expect(prisma.supportTicket.findMany).toHaveBeenCalledTimes(1);
  });
});
