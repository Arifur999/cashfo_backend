import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { invoiceFileName, invoiceView, renderInvoicePdf } from './pdf/invoice-pdf-layout.js';

export interface InvoicePdf {
  fileName: string;
  data: Buffer;
  invoice: {
    id: string;
    invoiceNumber: string;
    paymentId: string;
    totalAmount: { toString(): string };
    createdAt: Date;
    planName: string;
    userId: string | null;
    platformUserId: string | null;
  };
}

// An invoice as a PDF, made on demand each time it is downloaded or
// emailed (Invoice.pdfUrl stays null: nothing is stored).
@Injectable()
export class InvoicePdfService {
  private readonly logger = new Logger(InvoicePdfService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly mail: MailService,
  ) {}

  // ownerUserId: only that customer's own invoice; anyone else's is a 404,
  // the same as one that doesn't exist.
  async render(id: string, ownerUserId?: string): Promise<InvoicePdf> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, ...(ownerUserId !== undefined && { payment: { userId: ownerUserId } }) },
      include: { payment: { include: { plan: { select: { name: true } }, refund: { select: { amount: true, status: true, createdAt: true } } } } },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    const [platformName, supportEmail] = await Promise.all([this.mail.platformName(), this.supportEmail()]);
    const data = renderInvoicePdf(invoiceView({ platformName, supportEmail, invoice, payment: invoice.payment }));
    return {
      fileName: invoiceFileName(invoice.invoiceNumber),
      data,
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        paymentId: invoice.paymentId,
        totalAmount: invoice.totalAmount,
        createdAt: invoice.createdAt,
        planName: invoice.payment.plan.name,
        userId: invoice.payment.userId,
        platformUserId: invoice.payment.platformUserId,
      },
    };
  }

  // A settings hiccup leaves the address off rather than failing the PDF.
  private async supportEmail(): Promise<string | null> {
    try {
      return (await this.settings.getCached()).supportEmail || null;
    } catch (error) {
      this.logger.warn(`Could not read the support email for an invoice: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
}
