import type { PaymentGateway, PaymentPurpose, PaymentStatus, RefundStatus } from '@prisma/client';
import type { CsvCell } from '../account-export/csv.js';
import type { RequesterPerson } from '../admin-feed/requester-names.js';
import { displayPaymentId } from '../billing/billing-text.js';
import { dhakaDateKey } from '../common/dhaka.js';

// The most rows one export writes. More than that is a sign the filters
// are too wide for a spreadsheet; the response says it was cut short.
export const EXPORT_ROW_CAP = 10_000;

export const PAYMENT_EXPORT_HEADERS = [
  'Payment',
  'Date (Dhaka)',
  'Customer',
  'Email',
  'Plan',
  'Purpose',
  'Gateway',
  'List price',
  'Discount',
  'Amount',
  'Status',
  'Gateway reference',
  'Paid at (Dhaka)',
  'Invoice',
  'Refunded',
];

type Money = { toString(): string };

export interface ExportPayment {
  id: string;
  userId: string | null;
  platformUserId: string | null;
  createdAt: Date;
  purpose: PaymentPurpose;
  gateway: PaymentGateway;
  status: PaymentStatus;
  listPrice: Money | null;
  discountApplied: Money | null;
  amount: Money;
  gatewayReferenceId: string | null;
  paidAt: Date | null;
  plan: { name: string };
  invoice: { invoiceNumber: string } | null;
  refund: { amount: Money; status: RefundStatus } | null;
}

const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

// "2026-10-01 10:14" on the Dhaka clock, which a spreadsheet reads as a
// date and time.
export function dhakaDateTime(date: Date | null): string {
  if (!date) return '';
  return `${dhakaDateKey(date)} ${new Date(date.getTime() + DHAKA_OFFSET_MS).toISOString().slice(11, 16)}`;
}

const money = (value: Money | null | undefined) => (value === null || value === undefined ? '' : Number(value.toString()).toFixed(2));

// The discount the payment got: the stored one, or for an older row the
// gap between the list price and what was paid.
function discountOf(payment: ExportPayment): string {
  if (payment.discountApplied !== null) return money(payment.discountApplied);
  if (payment.listPrice === null) return '';
  const gap = Math.round((Number(payment.listPrice.toString()) - Number(payment.amount.toString())) * 100) / 100;
  return gap > 0 ? gap.toFixed(2) : '0.00';
}

export function paymentExportRow(payment: ExportPayment, payer: RequesterPerson | null): CsvCell[] {
  return [
    displayPaymentId(payment.id),
    dhakaDateTime(payment.createdAt),
    payer?.name ?? '',
    payer?.email ?? '',
    payment.plan.name,
    payment.purpose,
    payment.gateway,
    money(payment.listPrice),
    discountOf(payment),
    money(payment.amount),
    payment.status,
    payment.gatewayReferenceId ?? '',
    dhakaDateTime(payment.paidAt),
    payment.invoice?.invoiceNumber ?? '',
    // Money that actually went back; a refund still waiting isn't.
    payment.refund?.status === 'COMPLETED' ? money(payment.refund.amount) : '',
  ];
}

export const paymentsExportFileName = (now: Date = new Date()) => `payments-${dhakaDateKey(now)}.csv`;
