import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentStatus, Prisma } from '@prisma/client';
import { dhakaDateKey, dhakaMonthStart, dhakaToday } from '../common/dhaka.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ListPaymentsQueryDto } from './dto/list-payments-query.dto.js';
import { DUPLICATE_WINDOW_MS, duplicateOf, type DuplicateCandidate } from './payment-extras.js';
import { RefundPaymentDto } from './dto/refund-payment.dto.js';
import { SimulatePaymentDto } from './dto/simulate-payment.dto.js';

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListPaymentsQueryDto, forcedStatus?: PaymentStatus) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    const where: Prisma.PaymentWhereInput = {};
    if (forcedStatus) where.status = forcedStatus;
    else if (query.status) where.status = query.status;

    if (query.gateway) where.gateway = query.gateway;
    if (query.planId) where.planId = query.planId;
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {
        ...(query.dateFrom && { gte: new Date(query.dateFrom) }),
        ...(query.dateTo && { lte: new Date(query.dateTo) }),
      };
    }
    if (query.search) {
      const search = query.search.trim();
      const matchingUsers = await this.prisma.platformUser.findMany({
        where: {
          OR: [{ name: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }],
        },
        select: { id: true },
      });
      // The list shows the first part of a payment's id, so typing that
      // finds it too, as does the gateway's own reference.
      where.OR = [
        { platformUserId: { in: matchingUsers.map((u) => u.id) } },
        { invoice: { invoiceNumber: { contains: search, mode: 'insensitive' } } },
        { gatewayReferenceId: { contains: search, mode: 'insensitive' } },
        { id: { startsWith: search.toLowerCase() } },
      ];
    }

    const [payments, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          plan: { select: { id: true, name: true, slug: true } },
          invoice: { select: { id: true, invoiceNumber: true } },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);

    return { data: await this.attachExtras(payments), meta: { page, limit, total, totalPage: Math.ceil(total / limit) } };
  }

  failed(query: ListPaymentsQueryDto) {
    return this.list(query, PaymentStatus.FAILED);
  }

  // The figures over the payments list: last month's takings and this
  // month's so far (net of refunds, like the revenue page), what failed in
  // the last week, last month's refunds, how people paid last month, and
  // how many payments each status holds for the tabs.
  async stats() {
    const { year, month, day } = dhakaToday();
    const thisMonthStart = dhakaMonthStart(year, month);
    const lastMonthStart = dhakaMonthStart(year, month - 1);
    const monthBeforeStart = dhakaMonthStart(year, month - 2);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [kept, failed, refundsLastMonth, byStatus] = await Promise.all([
      this.prisma.payment.findMany({
        where: { status: { in: [PaymentStatus.SUCCESS, PaymentStatus.REFUNDED] }, createdAt: { gte: monthBeforeStart } },
        select: { amount: true, createdAt: true, gateway: true, refund: { select: { amount: true, status: true } } },
      }),
      this.prisma.payment.aggregate({ where: { status: PaymentStatus.FAILED, createdAt: { gte: weekAgo } }, _count: true, _sum: { amount: true } }),
      this.prisma.refund.aggregate({ where: { status: 'COMPLETED', createdAt: { gte: lastMonthStart, lt: thisMonthStart } }, _count: true, _sum: { amount: true } }),
      this.prisma.payment.groupBy({ by: ['status'], _count: true }),
    ]);

    const net = (payment: (typeof kept)[number]) => Number(payment.amount) - (payment.refund?.status === 'COMPLETED' ? Number(payment.refund.amount) : 0);
    const inWindow = (from: Date, to?: Date) => kept.filter((payment) => payment.createdAt >= from && (!to || payment.createdAt < to));
    const total = (payments: typeof kept) => Math.round(payments.reduce((sum, payment) => sum + net(payment), 0) * 100) / 100;
    const lastMonth = inWindow(lastMonthStart, thisMonthStart);
    const monthBefore = inWindow(monthBeforeStart, lastMonthStart);
    const thisMonth = inWindow(thisMonthStart);
    const lastMonthTotal = total(lastMonth);
    const monthBeforeTotal = total(monthBefore);

    const gatewayCounts = new Map<string, number>();
    for (const payment of lastMonth) gatewayCounts.set(payment.gateway, (gatewayCounts.get(payment.gateway) ?? 0) + 1);

    const statusCounts = Object.fromEntries(Object.values(PaymentStatus).map((status) => [status, 0])) as Record<PaymentStatus, number>;
    for (const row of byStatus) statusCounts[row.status] = row._count;

    return {
      lastMonth: {
        month: dhakaDateKey(lastMonthStart).slice(0, 7),
        collected: lastMonthTotal.toFixed(2),
        payments: lastMonth.length,
        changePct: monthBeforeTotal > 0 ? Math.round(((lastMonthTotal - monthBeforeTotal) / monthBeforeTotal) * 1000) / 10 : null,
      },
      thisMonth: { month: dhakaDateKey(thisMonthStart).slice(0, 7), collected: total(thisMonth).toFixed(2), payments: thisMonth.length, days: day },
      failedLast7Days: { count: failed._count, amount: Number(failed._sum.amount ?? 0).toFixed(2) },
      refundsLastMonth: { count: refundsLastMonth._count, amount: Number(refundsLastMonth._sum.amount ?? 0).toFixed(2) },
      gatewaysLastMonth: [...gatewayCounts].map(([gateway, count]) => ({ gateway, count })).sort((a, b) => b.count - a.count),
      statusCounts,
    };
  }

  async getById(id: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: {
        plan: { select: { id: true, name: true, slug: true } },
        invoice: true,
        refund: true,
      },
    });
    if (!payment) {
      throw new NotFoundException('Payment not found');
    }
    const [[withExtras], otherPayments] = await Promise.all([
      this.attachExtras([payment]),
      // The same person's other payments, newest first.
      this.prisma.payment.findMany({
        where: { platformUserId: payment.platformUserId, id: { not: id } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, amount: true, currency: true, status: true, createdAt: true },
      }),
    ]);
    return { ...withExtras, otherPayments };
  }

  async retry(id: string, adminId: string, ipAddress?: string) {
    const payment = await this.requirePayment(id);
    if (payment.status !== PaymentStatus.FAILED) {
      throw new BadRequestException('Only failed payments can be retried');
    }

    return this.prisma.$transaction(async (tx) => {
      const result = await tx.payment.update({ where: { id }, data: { status: PaymentStatus.PENDING } });
      await tx.auditLog.create({
        data: {
          adminUserId: adminId,
          action: 'PAYMENT_RETRY_TRIGGERED',
          entityType: 'Payment',
          entityId: id,
          oldValue: { status: payment.status },
          newValue: { status: PaymentStatus.PENDING },
          ipAddress,
        },
      });
      return result;
    });
  }

  async refund(id: string, dto: RefundPaymentDto, adminId: string, ipAddress?: string) {
    const payment = await this.requirePayment(id);

    if (payment.status !== PaymentStatus.SUCCESS) {
      throw new BadRequestException('Only successful payments can be refunded');
    }
    if (dto.amount > Number(payment.amount)) {
      throw new BadRequestException('Refund amount cannot exceed the original payment amount');
    }

    return this.prisma.$transaction(async (tx) => {
      // Claimed with a condition: of two refunds sent at once, only one moves
      // the payment off SUCCESS; the other stops here instead of failing on
      // the one-refund-per-payment unique index with a 500.
      const claimed = await tx.payment.updateMany({ where: { id, status: PaymentStatus.SUCCESS }, data: { status: PaymentStatus.REFUNDED } });
      if (claimed.count === 0) {
        throw new ConflictException('This payment has already been refunded');
      }

      const refund = await tx.refund.create({
        data: {
          paymentId: id,
          amount: dto.amount,
          reason: dto.reason,
          processedBy: adminId,
          status: 'COMPLETED',
        },
      });

      const updatedPayment = await tx.payment.findUniqueOrThrow({ where: { id } });

      await tx.auditLog.create({
        data: {
          adminUserId: adminId,
          action: 'PAYMENT_REFUNDED',
          entityType: 'Payment',
          entityId: id,
          oldValue: { status: payment.status },
          newValue: { status: PaymentStatus.REFUNDED, amount: dto.amount, reason: dto.reason },
          ipAddress,
        },
      });

      return { payment: updatedPayment, refund };
    });
  }

  async simulatePayment(dto: SimulatePaymentDto) {
    if (process.env.NODE_ENV === 'production') {
      // Belt-and-suspenders -- the route is also excluded from the module in
      // production (see payments.module.ts), so this should be unreachable,
      // but never trust routing alone for a dev-only mutation endpoint.
      throw new ForbiddenException('Not available in production');
    }

    const [user, plan] = await Promise.all([
      this.prisma.platformUser.findUnique({ where: { id: dto.platformUserId } }),
      this.prisma.subscriptionPlan.findUnique({ where: { id: dto.planId } }),
    ]);
    if (!user) throw new NotFoundException('Platform user not found');
    if (!plan) throw new NotFoundException('Plan not found');

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          platformUserId: user.id,
          planId: plan.id,
          amount: plan.price,
          currency: plan.currency,
          gateway: 'MANUAL',
          gatewayReferenceId: `SIM-${Date.now()}`,
          status: PaymentStatus.SUCCESS,
          paidAt: new Date(),
        },
      });

      const invoiceNumber = await this.generateInvoiceNumber(tx);
      const invoice = await tx.invoice.create({
        data: {
          paymentId: payment.id,
          invoiceNumber,
          issuedTo: `${user.name} <${user.email}>`,
          lineItems: [{ description: `${plan.name} subscription`, amount: Number(plan.price) }],
          totalAmount: plan.price,
        },
      });

      return { payment, invoice };
    });
  }

  async generateInvoiceNumber(tx: Prisma.TransactionClient = this.prisma): Promise<string> {
    const year = new Date().getFullYear();
    const count = await tx.invoice.count({ where: { invoiceNumber: { startsWith: `INV-${year}-` } } });
    return `INV-${year}-${String(count + 1).padStart(6, '0')}`;
  }

  private async requirePayment(id: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id } });
    if (!payment) {
      throw new NotFoundException('Payment not found');
    }
    return payment;
  }

  // Payment.platformUserId is a loose reference (no Prisma relation to
  // PlatformUser, same convention used elsewhere in this schema), so names
  // are fetched separately and merged in here.
  // What a row needs beyond its own columns: who paid, the coupon's code
  // (Payment keeps only the id), and whether it looks like a double charge
  // of an earlier payment by the same person for the same plan.
  private async attachExtras<T extends DuplicateCandidate & { couponId: string | null }>(
    payments: T[],
  ): Promise<(T & { platformUser: { id: string; name: string; email: string } | null; couponCode: string | null; duplicateOfId: string | null })[]> {
    if (payments.length === 0) return [];
    const userIds = [...new Set(payments.map((p) => p.platformUserId))];
    const couponIds = [...new Set(payments.flatMap((p) => (p.couponId ? [p.couponId] : [])))];
    const earliest = new Date(Math.min(...payments.map((p) => p.createdAt.getTime())) - DUPLICATE_WINDOW_MS);
    const latest = new Date(Math.max(...payments.map((p) => p.createdAt.getTime())));
    const [users, coupons, neighbours] = await Promise.all([
      this.prisma.platformUser.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }),
      couponIds.length > 0 ? this.prisma.coupon.findMany({ where: { id: { in: couponIds } }, select: { id: true, code: true } }) : [],
      this.prisma.payment.findMany({
        where: { platformUserId: { in: userIds }, createdAt: { gte: earliest, lte: latest } },
        select: { id: true, platformUserId: true, planId: true, status: true, createdAt: true },
      }),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const codeById = new Map(coupons.map((c) => [c.id, c.code]));
    return payments.map((p) => ({
      ...p,
      platformUser: userById.get(p.platformUserId) ?? null,
      couponCode: p.couponId ? (codeById.get(p.couponId) ?? null) : null,
      duplicateOfId: duplicateOf(p, neighbours),
    }));
  }
}
