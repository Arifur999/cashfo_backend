import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { ListPaymentsQueryDto } from './dto/list-payments-query.dto.js';
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
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {
        ...(query.dateFrom && { gte: new Date(query.dateFrom) }),
        ...(query.dateTo && { lte: new Date(query.dateTo) }),
      };
    }
    if (query.search) {
      const matchingUsers = await this.prisma.platformUser.findMany({
        where: {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { email: { contains: query.search, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      });
      where.OR = [
        { platformUserId: { in: matchingUsers.map((u) => u.id) } },
        { invoice: { invoiceNumber: { contains: query.search, mode: 'insensitive' } } },
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

    return { data: await this.attachPlatformUsers(payments), meta: { page, limit, total, totalPage: Math.ceil(total / limit) } };
  }

  failed(query: ListPaymentsQueryDto) {
    return this.list(query, PaymentStatus.FAILED);
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
    const [withUser] = await this.attachPlatformUsers([payment]);
    return withUser;
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
      const refund = await tx.refund.create({
        data: {
          paymentId: id,
          amount: dto.amount,
          reason: dto.reason,
          processedBy: adminId,
          status: 'COMPLETED',
        },
      });

      const updatedPayment = await tx.payment.update({ where: { id }, data: { status: PaymentStatus.REFUNDED } });

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
  private async attachPlatformUsers<T extends { platformUserId: string }>(
    payments: T[],
  ): Promise<(T & { platformUser: { id: string; name: string; email: string } | null })[]> {
    const userIds = [...new Set(payments.map((p) => p.platformUserId))];
    const users = await this.prisma.platformUser.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true },
    });
    const userById = new Map(users.map((u) => [u.id, u]));
    return payments.map((p) => ({ ...p, platformUser: userById.get(p.platformUserId) ?? null }));
  }
}
