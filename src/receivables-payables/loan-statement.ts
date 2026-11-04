import { Prisma, type EntryType, type TransactionStatus, type TransactionType } from '@prisma/client';
import type { LoanEntryKind } from './loan-activity.js';

// A loan contact's statement: the principal they owe (or are owed) after
// every loan, repayment and profit posting, oldest first. Pure, so the
// running balance is tested on its own.
//
// A voided posting and the reversal that undid it are both listed, flagged
// cancelled, and neither moves the balance -- the contact statement's rule
// (contact-statement.ts). Counting both made the running principal jump up
// and back down, and the Paid and Received columns add up money that never
// moved.

export interface LoanStatementRow {
  transactionId: string;
  date: Date;
  referenceNo: string | null;
  description: string | null;
  category: string;
  // DEBIT on the AR/AP side of a transaction always mirrors a CREDIT on
  // that same transaction's money-account side (double-entry) -- which is
  // exactly the "cash left the business" case (a loan given out, or a
  // payment made on money borrowed). So debit here means "Paid" and
  // credit means "Received", regardless of whether the entry happens to
  // sit on the Accounts Receivable or the Accounts Payable account.
  debit: string | null;
  credit: string | null;
  // A Profit row: what was paid or received. Its runningPrincipal is the
  // balance it left untouched.
  profitPaid: string | null;
  profitReceived: string | null;
  runningPrincipal: string;
  status: TransactionStatus;
  // The posting this one reversed, for a reversal.
  reversalOfId: string | null;
  // Voided, or the reversal that voided it: shown, but not counted.
  cancelled: boolean;
  // What happened: a loan given or taken, money back either way, or profit
  // paid or received (the statement's "What happened").
  kind: LoanEntryKind;
  // A bank or service charge posted with it, else null (added by the
  // service, which reads the charges).
  charge?: string | null;
}

// What the statement reads of a posting.
export interface LoanStatementPosting {
  id: string;
  transactionType: TransactionType;
  transactionDate: Date;
  createdAt: Date;
  referenceNo: string | null;
  description: string | null;
  status: TransactionStatus;
  reversalOfId: string | null;
}

export type LoanStatementItem =
  // A loan or repayment: its line on the receivable or the payable.
  | { transaction: LoanStatementPosting; principal: { entryType: EntryType; amount: Prisma.Decimal | string | number } }
  // Profit or interest paid or received: the sum of its debit lines.
  | { transaction: LoanStatementPosting; principal: null; profit: Prisma.Decimal | string | number };

export const isCancelledPosting = (posting: Pick<LoanStatementPosting, 'status' | 'reversalOfId'>): boolean =>
  posting.status === 'VOIDED' || posting.reversalOfId !== null;

// The rows in date order (then the order they were made), each with the
// principal after it, starting from what was brought forward.
export function loanStatementRows(items: LoanStatementItem[], broughtForward: Prisma.Decimal): LoanStatementRow[] {
  const sorted = [...items].sort(
    (a, b) => a.transaction.transactionDate.getTime() - b.transaction.transactionDate.getTime() || a.transaction.createdAt.getTime() - b.transaction.createdAt.getTime(),
  );
  let running = broughtForward;
  return sorted.map((item) => {
    const { transaction } = item;
    const cancelled = isCancelledPosting(transaction);
    const base = {
      transactionId: transaction.id,
      date: transaction.transactionDate,
      referenceNo: transaction.referenceNo,
      description: transaction.description,
      status: transaction.status,
      reversalOfId: transaction.reversalOfId,
      cancelled,
    };
    if (item.principal === null) {
      const amount = new Prisma.Decimal(item.profit).toFixed(2);
      const paid = transaction.transactionType === 'EXPENSE';
      return {
        ...base,
        kind: paid ? ('PROFIT_PAID' as const) : ('PROFIT_RECEIVED' as const),
        category: 'Profit',
        debit: null,
        credit: null,
        profitPaid: paid ? amount : null,
        profitReceived: paid ? null : amount,
        runningPrincipal: running.toFixed(2),
      };
    }
    const amount = new Prisma.Decimal(item.principal.amount);
    if (!cancelled) running = running.plus(item.principal.entryType === 'DEBIT' ? amount : amount.negated());
    // A sale on credit is a loan given, a purchase one taken; a payment is
    // money back, out when it eased the payable (a debit), in otherwise.
    const out = item.principal.entryType === 'DEBIT';
    const kind: LoanEntryKind = transaction.transactionType === 'SALE' ? 'GAVE' : transaction.transactionType === 'PURCHASE' ? 'TOOK' : out ? 'PAID_BACK' : 'GOT_BACK';
    return {
      ...base,
      kind,
      category: 'Principal',
      debit: item.principal.entryType === 'DEBIT' ? amount.toFixed(2) : null,
      credit: item.principal.entryType === 'CREDIT' ? amount.toFixed(2) : null,
      profitPaid: null,
      profitReceived: null,
      runningPrincipal: running.toFixed(2),
    };
  });
}
