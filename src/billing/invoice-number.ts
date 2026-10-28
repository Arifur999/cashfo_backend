import type { Prisma } from '@prisma/client';

// The next invoice number for this year: INV-2026-000001, -000002, ...
// Numbered under a transaction-wide lock, so two payments confirmed at the
// same moment can't both take the same number.
export async function nextInvoiceNumber(tx: Prisma.TransactionClient, now = new Date()): Promise<string> {
  const year = now.getFullYear();
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('invoice-number'))`;
  const count = await tx.invoice.count({ where: { invoiceNumber: { startsWith: `INV-${year}-` } } });
  return formatInvoiceNumber(year, count + 1);
}

export const formatInvoiceNumber = (year: number, sequence: number): string => `INV-${year}-${String(sequence).padStart(6, '0')}`;
