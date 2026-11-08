import type { PaymentGateway, PaymentStatus, RefundStatus } from '@prisma/client';
import { dateLabel, displayPaymentId, methodName } from '../../billing/billing-text.js';
import { toPaisa } from '../../billing/pricing.js';
import { DEFAULT_PLATFORM_NAME } from '../../settings/settings.service.js';
import { isWinAnsiText, PdfDocument, type PdfColor, textWidth, wrapText } from './pdf-writer.js';

// What the invoice PDF is made from: the invoice row with its payment, and
// the platform's name and support address.
export interface InvoicePdfInput {
  platformName: string;
  supportEmail: string | null;
  invoice: {
    invoiceNumber: string;
    // The "Name <email>" snapshot taken when the invoice was made.
    issuedTo: string;
    // The billing phone printed under it; older invoices have none.
    issuedPhone?: string | null;
    lineItems: unknown;
    totalAmount: { toString(): string };
    createdAt: Date;
  };
  payment: {
    id: string;
    status: PaymentStatus;
    gateway: PaymentGateway;
    currency: string;
    gatewayReferenceId: string | null;
    payerAccount: string | null;
    paidAt: Date | null;
    periodStart: Date | null;
    periodEnd: Date | null;
    refund: { amount: { toString(): string }; status: RefundStatus; createdAt: Date } | null;
  };
}

export interface InvoiceLine {
  description: string;
  // "2 Oct 2026 - 1 Nov 2026" on the plan's line; blank on a discount.
  period: string;
  amount: string;
}

// Everything the page prints, already worded and formatted, so the layout
// below only places it.
export interface InvoiceView {
  platformName: string;
  // "Dhaka, Bangladesh · support@..."
  contactLine: string;
  invoiceNumber: string;
  // PAID, REFUNDED, PARTLY REFUNDED or UNPAID.
  stamp: string;
  issueDate: string;
  billedTo: { name: string | null; email: string | null; phone: string | null };
  lines: InvoiceLine[];
  subtotal: string;
  discount: string;
  total: string;
  totalLabel: string;
  payment: { displayId: string; method: string; reference: string | null; payerAccount: string | null; paidOn: string | null };
  refund: { amount: string; date: string } | null;
  footer: string[];
}

// "TK 12,50,000.00": lakh/crore grouping like the app, always with the
// paisa as an invoice shows them. The taka sign itself isn't in the PDF's
// standard fonts, hence "TK", as the app writes it in English (another
// currency prints its code).
export function invoiceMoney(paisa: number, currency = 'BDT'): string {
  const negative = paisa < 0;
  const whole = Math.floor(Math.abs(paisa) / 100);
  const fraction = String(Math.abs(paisa) % 100).padStart(2, '0');
  const digits = String(whole);
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  const grouped = rest ? `${rest},${last3}` : last3;
  return `${negative ? '- ' : ''}${currency === 'BDT' ? 'TK' : currency} ${grouped}.${fraction}`;
}

// The issuedTo snapshot split back into its name and email. A name the
// PDF fonts can't show (written in Bangla, say) is left out, and the email
// stands for the customer instead of a row of question marks.
export function billedTo(issuedTo: string): { name: string | null; email: string | null } {
  const match = /^(.*?)\s*<([^<>]+)>\s*$/.exec(issuedTo.trim());
  const name = (match ? match[1] : issuedTo).trim();
  const email = match ? match[2].trim() : null;
  const shownName = name && isWinAnsiText(name) ? name : null;
  return { name: shownName, email: email && isWinAnsiText(email) ? email : null };
}

// The line items as the invoice stored them ([{description, amount}]),
// tolerating anything odd in the JSON rather than failing the download.
export function storedLines(lineItems: unknown): { description: string; paisa: number }[] {
  if (!Array.isArray(lineItems)) return [];
  return lineItems.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const { description, amount } = item as { description?: unknown; amount?: unknown };
    const paisa = Math.round(Number(amount) * 100);
    if (!Number.isFinite(paisa)) return [];
    return [{ description: typeof description === 'string' && description.trim() ? description.trim() : 'Item', paisa }];
  });
}

const STAMPS: Record<PaymentStatus, string> = { SUCCESS: 'PAID', REFUNDED: 'REFUNDED', PENDING: 'UNPAID', FAILED: 'UNPAID' };

// The app's method names, capitalised for a label (bKash keeps its own).
const methodLabel = (gateway: PaymentGateway) => {
  const name = methodName(gateway, 'en');
  return gateway === 'BKASH' ? name : name.charAt(0).toUpperCase() + name.slice(1);
};

export function invoiceView(input: InvoicePdfInput): InvoiceView {
  const { invoice, payment } = input;
  const currency = payment.currency || 'BDT';
  const money = (paisa: number) => invoiceMoney(paisa, currency);
  const items = storedLines(invoice.lineItems);
  const charges = items.filter((item) => item.paisa >= 0);
  const discounts = items.filter((item) => item.paisa < 0);
  const subtotal = charges.reduce((sum, item) => sum + item.paisa, 0);
  const discount = discounts.reduce((sum, item) => sum - item.paisa, 0);
  const period = payment.periodStart && payment.periodEnd ? `${dateLabel(payment.periodStart, 'en')} - ${dateLabel(payment.periodEnd, 'en')}` : '';

  const refund = payment.refund?.status === 'COMPLETED' ? payment.refund : null;
  const refundPaisa = refund ? toPaisa(refund.amount) : 0;
  const totalPaisa = toPaisa(invoice.totalAmount);
  let stamp = STAMPS[payment.status];
  if (payment.status === 'REFUNDED' && refund && refundPaisa < totalPaisa) stamp = 'PARTLY REFUNDED';

  const platformName = input.platformName.trim() && isWinAnsiText(input.platformName) ? input.platformName.trim() : DEFAULT_PLATFORM_NAME;
  const supportEmail = input.supportEmail?.trim() && isWinAnsiText(input.supportEmail) ? input.supportEmail.trim() : null;
  const displayId = displayPaymentId(payment.id);

  return {
    platformName,
    contactLine: ['Dhaka, Bangladesh', supportEmail].filter(Boolean).join(' · '),
    invoiceNumber: invoice.invoiceNumber,
    stamp,
    issueDate: dateLabel(invoice.createdAt, 'en'),
    billedTo: { ...billedTo(invoice.issuedTo), phone: invoice.issuedPhone && isWinAnsiText(invoice.issuedPhone) ? invoice.issuedPhone : null },
    lines: [
      // The plan's period goes on the first charge (the plan itself).
      ...charges.map((item, index) => ({ description: item.description, period: index === 0 ? period : '', amount: money(item.paisa) })),
      ...discounts.map((item) => ({ description: item.description, period: '', amount: money(item.paisa) })),
    ],
    subtotal: money(subtotal),
    discount: money(discount),
    total: money(totalPaisa),
    totalLabel: payment.status === 'SUCCESS' || payment.status === 'REFUNDED' ? 'Total paid' : 'Total due',
    payment: {
      displayId,
      method: methodLabel(payment.gateway),
      reference: payment.gatewayReferenceId,
      payerAccount: payment.payerAccount,
      paidOn: payment.paidAt ? dateLabel(payment.paidAt, 'en') : null,
    },
    refund: refund ? { amount: money(refundPaisa), date: dateLabel(refund.createdAt, 'en') } : null,
    footer: [
      `Thank you for using ${platformName}. Questions about this invoice? Reply from the Help page in the app.`,
      `${invoice.invoiceNumber} was made automatically when ${displayId} was paid.`,
    ],
  };
}

// The app's colours (globals.css): ink, body text, muted text, the brand
// green, hairlines and the soft fills.
const INK: PdfColor = [0.071, 0.125, 0.114];
const BODY: PdfColor = [0.29, 0.341, 0.329];
const MUTED: PdfColor = [0.541, 0.588, 0.576];
const BRAND: PdfColor = [0.11, 0.459, 0.404];
const HAIRLINE: PdfColor = [0.882, 0.906, 0.902];
const SOFT: PdfColor = [0.957, 0.961, 0.961];
const STAMP_FILLS: Record<string, { fill: PdfColor; text: PdfColor }> = {
  PAID: { fill: [0.863, 0.929, 0.914], text: [0.082, 0.361, 0.318] },
  REFUNDED: { fill: SOFT, text: BODY },
  'PARTLY REFUNDED': { fill: [0.996, 0.953, 0.78], text: [0.573, 0.251, 0.055] },
  UNPAID: { fill: [0.996, 0.949, 0.949], text: [0.725, 0.11, 0.11] },
};

// The largest size, down to 7pt, at which the text fits the width, so a
// long name or email stays in its column.
export function fitSize(text: string, font: 'regular' | 'bold', size: number, maxWidth: number): number {
  const width = textWidth(text, font, size);
  return width <= maxWidth ? size : Math.max(7, Math.floor(((size * maxWidth) / width) * 10) / 10);
}

const MARGIN = 56;
const BOTTOM = 72;

// The invoice as a one-page A4 PDF (a long list of items runs onto more).
export function renderInvoicePdf(view: InvoiceView): Buffer {
  const doc = new PdfDocument();
  let page = doc.addPage();
  const right = page.width - MARGIN;
  const contentWidth = right - MARGIN;
  let y = MARGIN;

  // Moves down, starting a fresh page when the next block wouldn't fit.
  const room = (needed: number) => {
    if (y + needed <= page.height - BOTTOM) return;
    page = doc.addPage();
    y = MARGIN;
  };

  // Header: the platform and its contact line; the word INVOICE and the
  // number on the right.
  page.rect(0, 0, page.width, 6, BRAND);
  page.text(MARGIN, y + 16, view.platformName, { font: 'bold', size: 18, color: INK });
  page.text(MARGIN, y + 34, view.contactLine, { size: 9, color: MUTED });
  page.text(right, y + 16, 'INVOICE', { font: 'bold', size: 20, color: BRAND, align: 'right' });
  page.text(right, y + 34, view.invoiceNumber, { font: 'bold', size: 10, color: INK, align: 'right' });

  // The status stamp under the number.
  const stamp = STAMP_FILLS[view.stamp] ?? STAMP_FILLS.UNPAID;
  const stampWidth = textWidth(view.stamp, 'bold', 9) + 16;
  page.rect(right - stampWidth, y + 44, stampWidth, 18, stamp.fill);
  page.text(right - stampWidth / 2, y + 56.5, view.stamp, { font: 'bold', size: 9, color: stamp.text, align: 'center' });
  y += 84;
  page.line(MARGIN, y, right, y, { width: 0.75, color: HAIRLINE });
  y += 24;

  // Who it is for, and when / which payment.
  const column = MARGIN + contentWidth / 2 + 12;
  const label = (x: number, at: number, text: string) => page.text(x, at, text.toUpperCase(), { font: 'bold', size: 8, color: MUTED });
  label(MARGIN, y, 'Billed to');
  label(column, y, 'Date');
  label(column + 110, y, 'Payment');
  let left = y + 16;
  if (view.billedTo.name) {
    page.text(MARGIN, left, view.billedTo.name, { font: 'bold', size: fitSize(view.billedTo.name, 'bold', 11, column - MARGIN - 12), color: INK });
    left += 15;
  }
  if (view.billedTo.email) {
    const font = view.billedTo.name ? 'regular' : 'bold';
    page.text(MARGIN, left, view.billedTo.email, {
      size: fitSize(view.billedTo.email, font, 10, column - MARGIN - 12),
      color: view.billedTo.name ? BODY : INK,
      font,
    });
    left += 15;
  }
  if (view.billedTo.phone) {
    page.text(MARGIN, left, view.billedTo.phone, { size: 10, color: BODY });
    left += 15;
  }
  page.text(column, y + 16, view.issueDate, { size: 10, color: INK });
  page.text(column + 110, y + 16, view.payment.displayId, { size: 10, color: INK });
  y = Math.max(left, y + 31) + 22;

  // The items: description, period, amount.
  const periodX = MARGIN + contentWidth * 0.5;
  const descriptionWidth = periodX - MARGIN - 20;
  page.rect(MARGIN, y, contentWidth, 24, SOFT);
  page.text(MARGIN + 10, y + 15.5, 'DESCRIPTION', { font: 'bold', size: 8, color: BODY });
  page.text(periodX, y + 15.5, 'PERIOD', { font: 'bold', size: 8, color: BODY });
  page.text(right - 10, y + 15.5, 'AMOUNT', { font: 'bold', size: 8, color: BODY, align: 'right' });
  y += 24;
  for (const line of view.lines) {
    const wrapped = wrapText(line.description, 'regular', 10, descriptionWidth);
    const height = Math.max(1, wrapped.length) * 13 + 16;
    room(height);
    wrapped.forEach((text, index) => page.text(MARGIN + 10, y + 18 + index * 13, text, { size: 10, color: INK }));
    if (line.period) page.text(periodX, y + 18, line.period, { size: 10, color: BODY });
    page.text(right - 10, y + 18, line.amount, { size: 10, color: INK, align: 'right' });
    y += height;
    page.line(MARGIN, y, right, y, { width: 0.5, color: HAIRLINE });
  }

  // The sums, right-aligned.
  room(110);
  y += 20;
  const sumLabelX = MARGIN + contentWidth * 0.55;
  const sum = (text: string, amount: string, bold = false) => {
    page.text(sumLabelX, y, text, { font: bold ? 'bold' : 'regular', size: bold ? 11 : 10, color: bold ? INK : BODY });
    page.text(right - 10, y, amount, { font: bold ? 'bold' : 'regular', size: bold ? 11 : 10, color: INK, align: 'right' });
    y += bold ? 20 : 17;
  };
  sum('Subtotal', view.subtotal);
  sum('Discount', view.discount);
  page.line(sumLabelX, y - 8, right, y - 8, { width: 0.75, color: HAIRLINE });
  y += 4;
  sum(view.totalLabel, view.total, true);
  if (view.refund) sum(`Refunded on ${view.refund.date}`, `- ${view.refund.amount}`);

  // How it was paid.
  room(90);
  y += 16;
  label(MARGIN, y, 'Payment details');
  y += 16;
  const detail = (name: string, value: string | null) => {
    if (!value) return;
    page.text(MARGIN, y, name, { size: 10, color: MUTED });
    page.text(MARGIN + 110, y, value, { size: 10, color: INK });
    y += 15;
  };
  detail('Paid with', view.payment.method);
  detail('Reference', view.payment.reference);
  detail('Paid from', view.payment.payerAccount);
  detail('Paid on', view.payment.paidOn);
  detail('Status', view.stamp.charAt(0) + view.stamp.slice(1).toLowerCase());

  // The footer, at the bottom of the last page.
  const footerLines = view.footer.flatMap((text) => wrapText(text, 'regular', 9, contentWidth));
  const footerTop = page.height - BOTTOM + 18 - footerLines.length * 12;
  if (footerTop < y + 12) {
    page = doc.addPage();
  }
  const top = page.height - BOTTOM + 18 - footerLines.length * 12;
  page.line(MARGIN, top - 14, right, top - 14, { width: 0.5, color: HAIRLINE });
  footerLines.forEach((text, index) => page.text(MARGIN, top + index * 12, text, { size: 9, color: MUTED }));

  return doc.toBuffer({ title: `Invoice ${view.invoiceNumber}`, producer: view.platformName });
}

// The download's file name: the invoice number, kept to safe characters.
export const invoiceFileName = (invoiceNumber: string) => `${invoiceNumber.replace(/[^A-Za-z0-9_-]/g, '') || 'invoice'}.pdf`;
