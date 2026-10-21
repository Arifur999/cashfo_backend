import { Prisma } from '@prisma/client';

// What a contact owes on one side -- the receivable (their sales on
// credit, loans given) or the payable (purchases on credit, loans taken) --
// worked out from their postings. Pure, so the allocation is tested on its
// own and the service can read many contacts' postings in a few queries:
//
// 1. Payments with `appliedToTransactionId` set reduce that specific
//    invoice's remaining balance directly.
// 2. Payments without a target are pooled; they settle the opening balance
//    first (it is the oldest amount owed), then the invoices FIFO -- oldest
//    outstanding invoice first -- until the pool is exhausted.
//
// This is entirely a read-time computation. TransactionEntry rows are never
// split or rewritten to reflect an allocation, so the ledger only ever sees
// the original, simple 2-entry transactions.

export type Direction = 'RECEIVABLE' | 'PAYABLE';

export interface InvoiceBreakdown {
  transactionId: string;
  date: Date;
  description: string | null;
  originalAmount: string;
  amountPaid: string;
  remainingAmount: string;
  dueDate: Date | null;
  isOverdue: boolean;
}

export interface DirectionBreakdown {
  totalInvoiced: string;
  totalPaid: string;
  // What the invoices still owe, after general payments settled the opening
  // balance first (it is the oldest amount owed). Negative when overpaid.
  remaining: string;
  // The contact's opening balance owed in this direction, and what of it is
  // still unpaid.
  openingOwed: string;
  openingRemaining: string;
  // Invoices minus payments: this direction's change to the contact's
  // balance, which adds the opening balance once on top.
  balance: string;
  transactions: InvoiceBreakdown[];
}

// What the breakdown reads of a sale, a purchase or a payment.
export interface DirectionPosting {
  id: string;
  transactionDate: Date;
  description: string | null;
  dueDate: Date | null;
  appliedToTransactionId: string | null;
  entries: { accountId: string; amount: Prisma.Decimal | string | number }[];
}

// One contact's breakdown on one side. `accountId` is the workspace's
// Accounts Receivable (or Payable) system account, null when it has none;
// `invoices` are the contact's standing sales (or purchases), oldest first;
// `payments` their standing payments, either way.
export function directionBreakdown(
  openingBalance: Prisma.Decimal | string | number,
  direction: Direction,
  accountId: string | null,
  invoices: DirectionPosting[],
  payments: DirectionPosting[],
  today: Date,
): DirectionBreakdown {
  // Pawna (positive) is owed on the receivable side, Dena (negative) on
  // the payable side.
  const opening = new Prisma.Decimal(openingBalance);
  const openingOwed = Prisma.Decimal.max(0, direction === 'RECEIVABLE' ? opening : opening.negated());

  if (!accountId) {
    return {
      totalInvoiced: '0.00',
      totalPaid: '0.00',
      remaining: '0.00',
      openingOwed: openingOwed.toFixed(2),
      openingRemaining: openingOwed.toFixed(2),
      balance: '0.00',
      transactions: [],
    };
  }

  // A contact of type BOTH can have both a receivable and a payable
  // relationship -- only count payments that actually touch THIS
  // direction's account, so the two pools never mix.
  const relevantPayments = payments.filter((p) => p.entries.some((e) => e.accountId === accountId));

  const originalAmount = new Map<string, Prisma.Decimal>();
  for (const inv of invoices) {
    const entry = inv.entries.find((e) => e.accountId === accountId);
    originalAmount.set(inv.id, entry ? new Prisma.Decimal(entry.amount) : new Prisma.Decimal(0));
  }

  const amountPaid = new Map<string, Prisma.Decimal>(invoices.map((inv) => [inv.id, new Prisma.Decimal(0)]));

  let generalPool = new Prisma.Decimal(0);
  for (const p of relevantPayments) {
    const entry = p.entries.find((e) => e.accountId === accountId);
    const amt = entry ? new Prisma.Decimal(entry.amount) : new Prisma.Decimal(0);
    if (p.appliedToTransactionId && amountPaid.has(p.appliedToTransactionId)) {
      amountPaid.set(p.appliedToTransactionId, amountPaid.get(p.appliedToTransactionId)!.plus(amt));
    } else {
      generalPool = generalPool.plus(amt);
    }
  }

  // The opening balance is the oldest amount owed, so general payments
  // settle it first -- otherwise collecting it would mark later invoices
  // paid, hiding them from aging and overdue and refusing payments
  // applied to them.
  const openingPaid = Prisma.Decimal.min(generalPool, openingOwed);
  generalPool = generalPool.minus(openingPaid);

  // FIFO: invoices come oldest-first.
  for (const inv of invoices) {
    if (generalPool.lessThanOrEqualTo(0)) break;
    const remaining = originalAmount.get(inv.id)!.minus(amountPaid.get(inv.id)!);
    if (remaining.lessThanOrEqualTo(0)) continue;
    const take = Prisma.Decimal.min(remaining, generalPool);
    amountPaid.set(inv.id, amountPaid.get(inv.id)!.plus(take));
    generalPool = generalPool.minus(take);
  }

  const transactions: InvoiceBreakdown[] = invoices.map((inv) => {
    const original = originalAmount.get(inv.id)!;
    const paid = amountPaid.get(inv.id)!;
    const remaining = Prisma.Decimal.max(0, original.minus(paid));
    const isOverdue = !!inv.dueDate && inv.dueDate.getTime() < today.getTime() && remaining.greaterThan(0);
    return {
      transactionId: inv.id,
      date: inv.transactionDate,
      description: inv.description,
      originalAmount: original.toFixed(2),
      amountPaid: paid.toFixed(2),
      remainingAmount: remaining.toFixed(2),
      dueDate: inv.dueDate,
      isOverdue,
    };
  });

  const totalInvoiced = transactions.reduce((sum, t) => sum.plus(t.originalAmount), new Prisma.Decimal(0));
  const totalPaid = relevantPayments.reduce((sum, p) => {
    const entry = p.entries.find((e) => e.accountId === accountId);
    return sum.plus(entry ? entry.amount : 0);
  }, new Prisma.Decimal(0));

  return {
    totalInvoiced: totalInvoiced.toFixed(2),
    totalPaid: totalPaid.toFixed(2),
    remaining: totalInvoiced.minus(totalPaid.minus(openingPaid)).toFixed(2),
    openingOwed: openingOwed.toFixed(2),
    openingRemaining: openingOwed.minus(openingPaid).toFixed(2),
    balance: totalInvoiced.minus(totalPaid).toFixed(2),
    transactions,
  };
}
