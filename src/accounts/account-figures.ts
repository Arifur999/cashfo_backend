import { AccountType, EntryType, Prisma } from '@prisma/client';

// The rules an account's figures are worked out by. Kept free of the two
// services so both can share them: account-balance.service.ts already
// imports accounts.service.ts, and an import back would be a cycle.

// Accounting rule (product blueprint): for ASSET/EXPENSE accounts, DEBIT
// increases the balance and CREDIT decreases it; for LIABILITY/EQUITY/
// INCOME accounts, it's the reverse. account-balance.service.ts re-exports
// it, so ReportsService reuses the exact same rule for the Trial Balance's
// debit/credit column split rather than redefining it.
export function isDebitPositive(accountType: AccountType): boolean {
  return accountType === 'ASSET' || accountType === 'EXPENSE';
}

// A transaction that still stands: neither voided nor the reversal of a void.
export const LIVE_TRANSACTION = { status: 'POSTED', reversalOfId: null } satisfies Prisma.TransactionWhereInput;

// A YYYY-MM-DD day as a @db.Date column holds it: that calendar day at UTC
// midnight, dhakaDateOnly()'s shape. transactionDate stores the Dhaka day an
// entry was made for, so `lte` this takes in the whole day.
export const dayDate = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

// dateFrom..dateTo, both days included, as a transactionDate filter;
// undefined when neither is set.
export function dayWindow(filters: { dateFrom?: string; dateTo?: string }): Prisma.DateTimeFilter | undefined {
  if (!filters.dateFrom && !filters.dateTo) return undefined;
  return { ...(filters.dateFrom && { gte: dayDate(filters.dateFrom) }), ...(filters.dateTo && { lte: dayDate(filters.dateTo) }) };
}

export interface EntryTotals {
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
}

// A row of transactionEntry.groupBy({ by: ['accountId', 'entryType'], _sum: { amount: true } }).
export interface EntryTypeSum {
  accountId: string;
  entryType: EntryType;
  _sum: { amount: Prisma.Decimal | null };
}

const NO_ENTRIES: EntryTotals = { debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(0) };

// Each account's debit and credit totals from one such groupBy, for any
// number of accounts.
export function entryTotals(rows: EntryTypeSum[]): Map<string, EntryTotals> {
  const totals = new Map<string, EntryTotals>();
  for (const row of rows) {
    const current = totals.get(row.accountId) ?? NO_ENTRIES;
    const amount = new Prisma.Decimal(row._sum.amount ?? 0);
    totals.set(row.accountId, row.entryType === 'DEBIT' ? { ...current, debit: current.debit.plus(amount) } : { ...current, credit: current.credit.plus(amount) });
  }
  return totals;
}

// What the entries moved the account by, signed the way its type grows:
// debits less credits for ASSET/EXPENSE, credits less debits otherwise --
// as getAccountSummary() signs totalIn less totalOut, and
// recalculateBalance() the balance. No entries, no movement.
export function signedNet(accountType: AccountType, totals: EntryTotals = NO_ENTRIES): Prisma.Decimal {
  return isDebitPositive(accountType) ? totals.debit.minus(totals.credit) : totals.credit.minus(totals.debit);
}

export interface PeriodFigures {
  periodDebit: string;
  periodCredit: string;
  periodNet: string;
}

// An account's figures for a period: its debit and credit totals, and their
// net signed as signedNet() signs it. No entries, all zero.
export function periodFigures(accountType: AccountType, totals: EntryTotals = NO_ENTRIES): PeriodFigures {
  return { periodDebit: totals.debit.toFixed(2), periodCredit: totals.credit.toFixed(2), periodNet: signedNet(accountType, totals).toFixed(2) };
}
