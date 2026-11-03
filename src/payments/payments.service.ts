import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BillingCycle, PaymentStatus, Prisma } from '@prisma/client';
import { toCsv } from '../account-export/csv.js';
import { payerIdOf, requesterPeople, type RequesterPerson } from '../admin-feed/requester-names.js';
import { BillingHooks } from '../billing/billing-hooks.js';
import { BillingNotices } from '../billing/billing-notices.js';
import { PaymentGateways } from '../billing/gateways/payment-gateways.js';
import { nextInvoiceNumber } from '../billing/invoice-number.js';
import { PaymentConfirmationService } from '../billing/payment-confirmation.service.js';
import { REAL_FAILURE_WHERE } from '../billing/payment-reasons.js';
import { SubscriptionsService } from '../billing/subscriptions.service.js';
import { dhakaDateKey, dhakaMonthStart, dhakaToday } from '../common/dhaka.js';
import { END_USER_WHERE } from '../common/roles.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ListPaymentsQueryDto } from './dto/list-payments-query.dto.js';
import type { MarkPaidDto } from './dto/mark-paid.dto.js';
import { DUPLICATE_WINDOW_MS, countByStatus, duplicateOf, paymentIdPrefix, type DuplicateCandidate } from './payment-extras.js';
import { EXPORT_ROW_CAP, PAYMENT_EXPORT_HEADERS, paymentExportRow, paymentsExportFileName } from './payments-export.js';
import { RefundPaymentDto } from './dto/refund-payment.dto.js';
import { SimulatePaymentDto } from './dto/simulate-payment.dto.js';

// Billing tickets this close to a payment (either side) show on its page.
const RELATED_TICKET_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly confirmation?: PaymentConfirmationService,
    private readonly subscriptions?: SubscriptionsService,
    private readonly hooks?: BillingHooks,
    private readonly notices?: BillingNotices,
    private readonly gateways?: PaymentGateways,
  ) {}

  async list(query: ListPaymentsQueryDto, forcedStatus?: PaymentStatus) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    // The status tabs are counted over every filter but the status, so
    // beside a gateway, a plan, a search or dates each tab says how many
    // rows it would show.
    const narrowed = await this.narrowedWhere(query);
    const status = forcedStatus ?? query.status;
    const where: Prisma.PaymentWhereInput = status ? { ...narrowed, status } : narrowed;

    const [payments, byStatus] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        // The id breaks ties, so a page never repeats or skips a payment
        // that shares its timestamp (the all-pages export reads every page).
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          plan: { select: { id: true, name: true, slug: true } },
          invoice: { select: { id: true, invoiceNumber: true, emailedAt: true } },
          // Enough of the refund to tell a partial one from a full one;
          // null when there is none.
          refund: { select: { amount: true, status: true, createdAt: true } },
        },
      }),
      this.prisma.payment.groupBy({ by: ['status'], where: narrowed, _count: true }),
    ]);

    // The total is read off the same counts (every payment has exactly one
    // status), so the open tab's count and the pager's "of N" always agree.
    const statusCounts = countByStatus(byStatus);
    const total = status ? statusCounts[status] : Object.values(statusCounts).reduce((sum, count) => sum + count, 0);

    return { data: await this.attachExtras(payments), meta: { page, limit, total, totalPage: Math.ceil(total / limit), statusCounts } };
  }

  // Every payment the list's filters (status included) match, as a CSV,
  // newest first, up to EXPORT_ROW_CAP rows. The page and limit are
  // ignored. Audited, since it hands out customers' names and emails.
  async exportCsv(query: ListPaymentsQueryDto, adminId: string, ipAddress?: string) {
    const narrowed = await this.narrowedWhere(query);
    const where: Prisma.PaymentWhereInput = query.status ? { ...narrowed, status: query.status } : narrowed;
    const found = await this.prisma.payment.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      // One more than the cap tells whether it was cut short.
      take: EXPORT_ROW_CAP + 1,
      select: {
        id: true,
        userId: true,
        platformUserId: true,
        createdAt: true,
        purpose: true,
        gateway: true,
        status: true,
        listPrice: true,
        discountApplied: true,
        amount: true,
        gatewayReferenceId: true,
        paidAt: true,
        plan: { select: { name: true } },
        invoice: { select: { invoiceNumber: true } },
        refund: { select: { amount: true, status: true } },
      },
    });
    const truncated = found.length > EXPORT_ROW_CAP;
    const payments = truncated ? found.slice(0, EXPORT_ROW_CAP) : found;
    const payers = await requesterPeople(this.prisma, payments.map(payerIdOf));
    const data = toCsv(
      PAYMENT_EXPORT_HEADERS,
      payments.map((payment) => {
        const payerId = payerIdOf(payment);
        return paymentExportRow(payment, payerId ? (payers.get(payerId) ?? null) : null);
      }),
    );

    const { page: _page, limit: _limit, ...filters } = query;
    await this.prisma.auditLog.create({
      data: {
        adminUserId: adminId,
        action: 'PAYMENTS_EXPORTED',
        entityType: 'Payment',
        newValue: { filters: { ...filters }, rows: payments.length, truncated },
        ipAddress,
      },
    });
    return { fileName: paymentsExportFileName(), data, rows: payments.length, truncated };
  }

  // Every filter of the list but the status.
  private async narrowedWhere(query: ListPaymentsQueryDto): Promise<Prisma.PaymentWhereInput> {
    const narrowed: Prisma.PaymentWhereInput = {};
    if (query.gateway) narrowed.gateway = query.gateway;
    if (query.planId) narrowed.planId = query.planId;
    if (query.userId) narrowed.userId = query.userId;
    if (query.dateFrom || query.dateTo) {
      narrowed.createdAt = {
        ...(query.dateFrom && { gte: new Date(query.dateFrom) }),
        ...(query.dateTo && { lte: new Date(query.dateTo) }),
      };
    }
    if (query.search) {
      const search = query.search.trim();
      const nameOrEmail = { OR: [{ name: { contains: search, mode: 'insensitive' as const } }, { email: { contains: search, mode: 'insensitive' as const } }] };
      // Customers (and, for old sandbox rows, PlatformUsers) whose name or
      // email matches; a customer's phone too.
      const [customers, legacy] = await Promise.all([
        this.prisma.user.findMany({
          where: { ...END_USER_WHERE, OR: [...nameOrEmail.OR, { phone: { contains: search, mode: 'insensitive' } }] },
          select: { id: true },
          take: 200,
        }),
        this.prisma.platformUser.findMany({ where: nameOrEmail, select: { id: true } }),
      ]);
      // The list shows the first part of a payment's id ("PAY-3F2A1C9B"),
      // so typing that, with or without PAY-, finds it too, as does the
      // gateway's own reference.
      const idPrefix = paymentIdPrefix(search);
      narrowed.OR = [
        { platformUserId: { in: legacy.map((u) => u.id) } },
        ...(customers.length > 0 ? [{ userId: { in: customers.map((u) => u.id) } }] : []),
        { invoice: { invoiceNumber: { contains: search, mode: 'insensitive' } } },
        { gatewayReferenceId: { contains: search, mode: 'insensitive' } },
        ...(idPrefix ? [{ id: { startsWith: idPrefix } }] : []),
      ];
    }
    return narrowed;
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
      // Closed checkouts (replaced, cancelled, lapsed) are not failures.
      this.prisma.payment.aggregate({ where: { status: PaymentStatus.FAILED, createdAt: { gte: weekAgo }, ...REAL_FAILURE_WHERE }, _count: true, _sum: { amount: true } }),
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
        // The cycle and list price word the Plan row: "Monthly Pro · ৳ 299 a month".
        plan: { select: { id: true, name: true, slug: true, billingCycle: true, price: true } },
        invoice: true,
        refund: true,
        // The customer's screenshot, without its bytes (proof()).
        proof: { select: { mimeType: true, size: true, createdAt: true } },
      },
    });
    if (!payment) {
      throw new NotFoundException('Payment not found');
    }
    const payerId = payerIdOf(payment);
    const [[withExtras], otherPayments, subscription, relatedTickets] = await Promise.all([
      this.attachExtras([payment]),
      // The same person's other payments, newest first.
      this.prisma.payment.findMany({
        where: { ...this.samePerson(payment), id: { not: id } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, amount: true, currency: true, status: true, createdAt: true },
      }),
      // The customer's plan now, for the Mark paid drawer and the detail.
      payment.userId
        ? this.prisma.userSubscription.findUnique({
            where: { userId: payment.userId },
            select: { status: true, currentPeriodEnd: true, trialEndsAt: true, cancelAtPeriodEnd: true, plan: { select: { id: true, name: true } } },
          })
        : null,
      // The payer's billing tickets from around the payment ("charged
      // twice?"), newest first. SupportTicket.platformUserId holds the
      // customer's User id.
      payerId
        ? this.prisma.supportTicket.findMany({
            where: {
              category: 'BILLING',
              platformUserId: payerId,
              createdAt: {
                gte: new Date(payment.createdAt.getTime() - RELATED_TICKET_WINDOW_MS),
                lte: new Date(payment.createdAt.getTime() + RELATED_TICKET_WINDOW_MS),
              },
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 10,
            select: { id: true, number: true, subject: true, status: true, priority: true, category: true, createdAt: true },
          })
        : [],
    ]);
    return {
      ...withExtras,
      otherPayments,
      relatedTickets,
      subscription: subscription && {
        planId: subscription.plan.id,
        planName: subscription.plan.name,
        status: subscription.status,
        currentPeriodEnd: subscription.currentPeriodEnd,
        trialEndsAt: subscription.trialEndsAt,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      },
    };
  }

  async proof(id: string) {
    const proof = await this.prisma.paymentProof.findUnique({ where: { paymentId: id }, select: { mimeType: true, data: true } });
    if (!proof) throw new NotFoundException('No screenshot for this payment');
    return proof;
  }

  // Confirms a customer's checkout: the plan, the period, the invoice and
  // the coupon's use, then the bell and a receipt.
  markPaid(id: string, dto: MarkPaidDto, adminId: string, ipAddress?: string) {
    return this.requireConfirmation().markPaid(
      id,
      { reference: dto.gatewayReferenceId, paidAt: dto.paidAt ? new Date(dto.paidAt) : undefined, payerAccount: dto.payerAccount || undefined, note: dto.note ?? null },
      { adminId, ipAddress },
    );
  }

  markFailed(id: string, reason: string, adminId: string, ipAddress?: string) {
    return this.requireConfirmation().markFailed(id, reason, { adminId, ipAddress });
  }

  // Retry re-opens a failed checkout: PENDING again, with a fresh expiry.
  retry(id: string, adminId: string, ipAddress?: string) {
    return this.requireConfirmation().reopen(id, { adminId, ipAddress });
  }

  async refund(id: string, dto: RefundPaymentDto, adminId: string, ipAddress?: string) {
    const payment = await this.requirePayment(id);

    if (payment.status !== PaymentStatus.SUCCESS) {
      throw new BadRequestException('Only successful payments can be refunded');
    }
    if (dto.amount > Number(payment.amount)) {
      throw new BadRequestException('Refund amount cannot exceed the original payment amount');
    }
    const full = Math.round(dto.amount * 100) >= Math.round(Number(payment.amount) * 100);

    const result = await this.prisma.$transaction(async (tx) => {
      // Claimed with a condition: of two refunds sent at once, only one moves
      // the payment off SUCCESS; the other stops here instead of failing on
      // the one-refund-per-payment unique index with a 500.
      const claimed = await tx.payment.updateMany({ where: { id, status: PaymentStatus.SUCCESS }, data: { status: PaymentStatus.REFUNDED } });
      if (claimed.count === 0) {
        throw new ConflictException('This payment has already been refunded');
      }

      // A real gateway gives the money back itself; the manual way has the
      // admin send it.
      const provider = this.gateways?.providerFor(payment.gateway);
      if (provider && provider !== this.gateways?.manual && provider.refund) await provider.refund(payment, dto.amount);

      const refund = await tx.refund.create({
        data: {
          paymentId: id,
          amount: dto.amount,
          reason: dto.reason,
          processedBy: adminId,
          status: 'COMPLETED',
        },
      });

      // A full refund of the period the customer is in takes the plan
      // away at once; a partial one keeps it.
      const planDropped = full && payment.userId ? await this.dropRefundedPlan(tx, payment, adminId) : false;

      const updatedPayment = await tx.payment.findUniqueOrThrow({ where: { id } });
      if (payment.userId) await this.hooks?.runRefunded(updatedPayment, tx, { amount: dto.amount, full });

      await tx.auditLog.create({
        data: {
          adminUserId: adminId,
          action: 'PAYMENT_REFUNDED',
          entityType: 'Payment',
          entityId: id,
          oldValue: { status: payment.status },
          newValue: { status: PaymentStatus.REFUNDED, amount: dto.amount, reason: dto.reason, planDropped },
          ipAddress,
        },
      });

      return { payment: updatedPayment, refund, planDropped };
    });

    if (payment.userId && this.notices) {
      const plan = await this.prisma.subscriptionPlan.findUnique({ where: { id: payment.planId }, select: { name: true } });
      await this.notices.bell(payment.userId, {
        key: `payment:${id}:refunded`,
        data: { event: 'PAYMENT_REFUNDED', paymentId: id, planName: plan?.name ?? null, amount: dto.amount.toFixed(2), full: full ? 1 : 0, planDropped: result.planDropped ? 1 : 0 },
      });
    }
    return result;
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
          listPrice: plan.price,
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

  generateInvoiceNumber(tx: Prisma.TransactionClient): Promise<string> {
    return nextInvoiceNumber(tx);
  }

  // Drops the customer to the free plan when the refunded payment paid for
  // the plan they are on and its period hasn't ended.
  private async dropRefundedPlan(tx: Prisma.TransactionClient, payment: { userId: string | null; planId: string; periodEnd: Date | null }, adminId: string) {
    if (!payment.userId || !this.subscriptions) return false;
    const sub = await tx.userSubscription.findUnique({ where: { userId: payment.userId }, include: { plan: { select: { billingCycle: true } } } });
    if (!sub || sub.planId !== payment.planId || sub.plan.billingCycle === BillingCycle.FREE) return false;
    if (payment.periodEnd && payment.periodEnd <= new Date()) return false;
    await this.subscriptions.dropToFree(tx, payment.userId, 'CANCELLED', adminId, 'refund');
    return true;
  }

  private samePerson(payment: { userId: string | null; platformUserId: string | null }): Prisma.PaymentWhereInput {
    if (payment.userId) return { userId: payment.userId };
    if (payment.platformUserId) return { platformUserId: payment.platformUserId };
    // Nobody to match: no other payments.
    return { id: { in: [] } };
  }

  private requireConfirmation(): PaymentConfirmationService {
    if (!this.confirmation) throw new Error('PaymentConfirmationService is not available');
    return this.confirmation;
  }

  private async requirePayment(id: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id } });
    if (!payment) {
      throw new NotFoundException('Payment not found');
    }
    return payment;
  }

  // What a row needs beyond its own columns: who paid (a customer's User,
  // or for an old sandbox row its PlatformUser -- both loose references,
  // read separately), the coupon's code (Payment keeps only the id), and
  // whether it looks like a double charge of an earlier payment by the
  // same person for the same plan. `platformUser` keeps its old name for
  // the panel; it holds whoever paid.
  private async attachExtras<T extends DuplicateCandidate & { couponId: string | null }>(
    payments: T[],
  ): Promise<(T & { platformUser: RequesterPerson | null; couponCode: string | null; duplicateOfId: string | null })[]> {
    if (payments.length === 0) return [];
    const userIds = [...new Set(payments.flatMap((p) => (p.userId ? [p.userId] : [])))];
    const legacyIds = [...new Set(payments.flatMap((p) => (!p.userId && p.platformUserId ? [p.platformUserId] : [])))];
    const couponIds = [...new Set(payments.flatMap((p) => (p.couponId ? [p.couponId] : [])))];
    const earliest = new Date(Math.min(...payments.map((p) => p.createdAt.getTime())) - DUPLICATE_WINDOW_MS);
    const latest = new Date(Math.max(...payments.map((p) => p.createdAt.getTime())));
    const people: Prisma.PaymentWhereInput[] = [
      ...(userIds.length > 0 ? [{ userId: { in: userIds } }] : []),
      ...(legacyIds.length > 0 ? [{ platformUserId: { in: legacyIds } }] : []),
    ];
    const [payers, coupons, neighbours] = await Promise.all([
      requesterPeople(this.prisma, payments.map(payerIdOf)),
      couponIds.length > 0 ? this.prisma.coupon.findMany({ where: { id: { in: couponIds } }, select: { id: true, code: true } }) : [],
      people.length > 0
        ? this.prisma.payment.findMany({
            where: { OR: people, createdAt: { gte: earliest, lte: latest } },
            select: { id: true, userId: true, platformUserId: true, planId: true, status: true, createdAt: true },
          })
        : [],
    ]);
    const codeById = new Map(coupons.map((c) => [c.id, c.code]));
    return payments.map((p) => {
      const payerId = payerIdOf(p);
      return {
        ...p,
        platformUser: payerId ? (payers.get(payerId) ?? null) : null,
        couponCode: p.couponId ? (codeById.get(p.couponId) ?? null) : null,
        duplicateOfId: duplicateOf(p, neighbours),
      };
    });
  }
}
