import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { BILLING_SELECT, billingRecipient } from '../billing/billing-details.js';
import { dateLabel, formatTaka, localeOf } from '../billing/billing-text.js';
import { toPaisa } from '../billing/pricing.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ListInvoicesQueryDto } from './dto/list-invoices-query.dto.js';
import { InvoicePdfService } from './invoice-pdf.service.js';

// Where the email's button leads in the customer app (like the receipt's).
const BILLING_PATH = '/settings/plans';

const emailNotConfigured = () =>
  new ServiceUnavailableException({
    statusCode: 503,
    error: 'Service Unavailable',
    message: 'Email is not set up for the platform yet, so the invoice cannot be sent. Download the PDF and send it yourself.',
    reason: 'EMAIL_NOT_CONFIGURED',
  });

const emailNotSent = () =>
  new ServiceUnavailableException({
    statusCode: 503,
    error: 'Service Unavailable',
    message: 'The invoice email could not be sent. Try again in a minute.',
    reason: 'EMAIL_NOT_SENT',
  });

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoicePdf?: InvoicePdfService,
    private readonly mail?: MailService,
    private readonly config?: ConfigService,
  ) {}

  async list(query: ListInvoicesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    const where: Prisma.InvoiceWhereInput = {};
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {
        ...(query.dateFrom && { gte: new Date(query.dateFrom) }),
        ...(query.dateTo && { lte: new Date(query.dateTo) }),
      };
    }
    const person = query.userId ?? query.platformUserId;
    if (person) {
      where.payment = { OR: [{ userId: person }, { platformUserId: person }] };
    }

    const [data, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        // The id breaks ties for invoices made in the same instant.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: { payment: { select: { id: true, userId: true, platformUserId: true, planId: true } } },
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return { data, meta: { page, limit, total, totalPage: Math.ceil(total / limit) } };
  }

  async getById(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      // The payment with every column, its status among them, and what went
      // back on it (null when nothing did), so the invoice page can stamp
      // PAID, REFUNDED or PARTLY REFUNDED without reading the payment again.
      include: {
        payment: {
          include: {
            // What the plan allows, for the line's "No monthly limit on
            // transactions, PDF reports, income goals".
            plan: { select: { id: true, name: true, featureLimits: true } },
            refund: { select: { amount: true, status: true, createdAt: true } },
          },
        },
      },
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    // The PDF is made on demand (GET :id/pdf), so pdfUrl stays null.
    return invoice;
  }

  // Emails the invoice to the customer who paid, with the PDF attached, in
  // their language. A legacy sandbox payment goes to its PlatformUser's
  // address, when it has one.
  async email(id: string, adminId: string, ipAddress?: string) {
    if (!this.mail?.configured || !this.invoicePdf) throw emailNotConfigured();
    const pdf = await this.invoicePdf.render(id);
    const { invoice } = pdf;

    let recipient: { name: string; email: string; locale: 'en' | 'bn' } | null = null;
    if (invoice.userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: invoice.userId },
        select: { ...BILLING_SELECT, preferredLanguage: true, status: true },
      });
      // A deleted account's address is not theirs to write to any more;
      // otherwise the billing email, when one is set.
      if (user?.email && user.status !== 'DELETED') recipient = { ...billingRecipient(user), locale: localeOf(user.preferredLanguage) };
    } else if (invoice.platformUserId) {
      const legacy = await this.prisma.platformUser.findUnique({ where: { id: invoice.platformUserId }, select: { name: true, email: true } });
      if (legacy?.email) recipient = { name: legacy.name, email: legacy.email, locale: 'en' };
    }
    if (!recipient) throw new BadRequestException('This invoice has no customer email address to send it to. Download the PDF instead.');

    try {
      await this.mail.sendInvoiceEmail(
        recipient.email,
        recipient.locale,
        {
          name: recipient.name,
          invoiceNumber: invoice.invoiceNumber,
          planName: invoice.planName,
          amount: formatTaka(toPaisa(invoice.totalAmount), recipient.locale),
          issuedOn: dateLabel(invoice.createdAt, recipient.locale),
          link: `${this.config?.get<string>('USER_FRONTEND_URL') ?? 'http://localhost:3000'}${BILLING_PATH}`,
        },
        [{ filename: pdf.fileName, content: pdf.data }],
      );
    } catch (error) {
      this.logger.warn(`Invoice ${invoice.invoiceNumber} email failed: ${error instanceof Error ? error.message : String(error)}`);
      throw emailNotSent();
    }

    const emailedAt = new Date();
    await this.prisma.$transaction([
      this.prisma.invoice.update({ where: { id }, data: { emailedAt } }),
      this.prisma.auditLog.create({
        data: {
          adminUserId: adminId,
          action: 'INVOICE_EMAILED',
          entityType: 'Invoice',
          entityId: id,
          newValue: { invoiceNumber: invoice.invoiceNumber, sentTo: recipient.email, paymentId: invoice.paymentId },
          ipAddress,
        },
      }),
    ]);
    return { success: true, sentTo: recipient.email, emailedAt };
  }
}
