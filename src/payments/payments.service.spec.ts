import { PaymentGateway, PaymentStatus } from '@prisma/client';
import { PaymentsService } from './payments.service.js';

type StatusRow = { status: PaymentStatus; _count: number };
type PageQuery = { where: Record<string, unknown>; include?: Record<string, unknown> };

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 1, 4, minutes));
const row = (id: string, minutes: number, overrides: Record<string, unknown> = {}) => ({
  id,
  platformUserId: 'mahbub',
  planId: 'monthly',
  couponId: null,
  amount: '299.00',
  currency: 'BDT',
  gateway: PaymentGateway.BKASH,
  status: PaymentStatus.SUCCESS,
  createdAt: at(minutes),
  plan: { id: 'monthly', name: 'Monthly Pro', slug: 'monthly-pro' },
  invoice: null,
  refund: null,
  ...overrides,
});

// 1,912 paid and 38 failed under whatever the list was narrowed to.
const COUNTS: StatusRow[] = [
  { status: PaymentStatus.SUCCESS, _count: 1912 },
  { status: PaymentStatus.FAILED, _count: 38 },
];

const setup = ({ rows = [] as ReturnType<typeof row>[], byStatus = COUNTS, people = [] as { id: string }[] } = {}) => {
  const prisma = {
    payment: {
      // The page is asked for with include; the look for double charges
      // asks with select and finds none here.
      findMany: vi.fn((args: PageQuery) => Promise.resolve(args.include ? rows : [])),
      groupBy: vi.fn().mockResolvedValue(byStatus),
      count: vi.fn(),
    },
    // The people a search matches, then the names on the rows.
    platformUser: { findMany: vi.fn().mockResolvedValue(people) },
    coupon: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return { service: new PaymentsService(prisma as never), prisma };
};

// The page of rows is the first payment read.
const pageQuery = (prisma: ReturnType<typeof setup>['prisma']) => prisma.payment.findMany.mock.calls[0][0];

describe('PaymentsService.list rows', () => {
  it("sends each row's refund, enough to tell a partial one from a full one, and null without one", async () => {
    const partial = { amount: '50.00', status: 'COMPLETED', createdAt: at(30) };
    const { service, prisma } = setup({ rows: [row('p-1', 12, { status: PaymentStatus.REFUNDED, refund: partial }), row('p-2', 14)] });

    const { data } = await service.list({});

    expect(pageQuery(prisma).include).toMatchObject({ refund: { select: { amount: true, status: true, createdAt: true } } });
    expect(data.map((payment) => payment.refund)).toEqual([partial, null]);
  });

  it('keeps the plan, the invoice and the extras each row had before', async () => {
    const { service, prisma } = setup({ rows: [row('p-1', 12)] });

    const { data } = await service.list({});

    expect(pageQuery(prisma).include).toMatchObject({
      plan: { select: { id: true, name: true, slug: true } },
      invoice: { select: { id: true, invoiceNumber: true } },
    });
    expect(data[0]).toMatchObject({ platformUser: null, couponCode: null, duplicateOfId: null });
  });
});

describe('PaymentsService.list meta.statusCounts', () => {
  it('counts the tabs under the same gateway, plan and dates, leaving the status out', async () => {
    const { service, prisma } = setup();

    await service.list({
      status: PaymentStatus.FAILED,
      gateway: PaymentGateway.BKASH,
      planId: 'monthly',
      dateFrom: '2026-10-01T00:00:00.000Z',
      dateTo: '2026-10-31T23:59:59.999Z',
    });

    const narrowed = {
      gateway: PaymentGateway.BKASH,
      planId: 'monthly',
      createdAt: { gte: new Date('2026-10-01T00:00:00.000Z'), lte: new Date('2026-10-31T23:59:59.999Z') },
    };
    expect(pageQuery(prisma).where).toEqual({ ...narrowed, status: PaymentStatus.FAILED });
    expect(prisma.payment.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.payment.groupBy).toHaveBeenCalledWith({ by: ['status'], where: narrowed, _count: true });
  });

  it('counts the tabs under the search too', async () => {
    const { service, prisma } = setup({ people: [{ id: 'u-mahbub' }] });

    await service.list({ search: ' PAY-3F2A ' });

    const { where } = prisma.payment.groupBy.mock.calls[0][0];
    expect(where).toEqual({
      OR: [
        { platformUserId: { in: ['u-mahbub'] } },
        { invoice: { invoiceNumber: { contains: 'PAY-3F2A', mode: 'insensitive' } } },
        { gatewayReferenceId: { contains: 'PAY-3F2A', mode: 'insensitive' } },
        { id: { startsWith: '3f2a' } },
      ],
    });
    // No tab is open, so the rows are read under exactly the same filters.
    expect(pageQuery(prisma).where).toEqual(where);
  });

  it('names every status, 0 for an empty tab, and reads the open tab as the total', async () => {
    const { service } = setup();

    const { meta } = await service.list({ status: PaymentStatus.FAILED, limit: 10 });

    expect(meta).toEqual({ page: 1, limit: 10, total: 38, totalPage: 4, statusCounts: { PENDING: 0, SUCCESS: 1912, FAILED: 38, REFUNDED: 0 } });
  });

  it('totals every tab when none is open, with no second count', async () => {
    const { service, prisma } = setup();

    const { meta } = await service.list({ page: 2, limit: 100 });

    expect(meta).toMatchObject({ page: 2, limit: 100, total: 1950, totalPage: 20 });
    expect(prisma.payment.count).not.toHaveBeenCalled();
  });

  it('is all zeros, with nothing to page, when no payment matches', async () => {
    const { service } = setup({ byStatus: [] });

    const { data, meta } = await service.list({ gateway: PaymentGateway.CARD });

    expect(data).toEqual([]);
    expect(meta).toEqual({ page: 1, limit: 10, total: 0, totalPage: 0, statusCounts: { PENDING: 0, SUCCESS: 0, FAILED: 0, REFUNDED: 0 } });
  });

  it('keeps the failed list on FAILED rows and still counts every tab', async () => {
    const { service, prisma } = setup();

    const { meta } = await service.failed({ gateway: PaymentGateway.NAGAD, status: PaymentStatus.SUCCESS });

    expect(pageQuery(prisma).where).toEqual({ gateway: PaymentGateway.NAGAD, status: PaymentStatus.FAILED });
    expect(prisma.payment.groupBy).toHaveBeenCalledWith({ by: ['status'], where: { gateway: PaymentGateway.NAGAD }, _count: true });
    expect(meta).toMatchObject({ total: 38, statusCounts: { SUCCESS: 1912, FAILED: 38 } });
  });
});
