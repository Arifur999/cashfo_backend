import { Prisma, type EntryType, type TransactionStatus, type TransactionType } from '@prisma/client';

// A customer's or supplier's statement in Books: their sales, purchases and
// payments oldest first, with what they owe after each one. Worked out here
// because the browser only ever had their newest 50 postings, so for anyone
// with more its running balance started in the wrong place. Pure, so the
// maths is tested on its own.
//
// The rules are the ones the browser used (booksDisplay.statementRows), so a
// short statement reads exactly as before:
// - only sales, purchases and the payments that settle the receivable or
//   the payable count; profit, transfers and journals are left out;
// - a voided posting and the reversal that undid it are both shown, flagged
//   cancelled, and neither moves the balance;
// - positive means they owe the business, negative that it owes them --
//   Contact.openingBalance's convention, which computeDirection() keeps.
//
// Where the browser and computeDirection() disagreed, this follows
// computeDirection(), so with no dates the closing balance is the headline
// Contact.currentBalance. Both differences are only possible through the raw
// transactions API; every posting this module makes has two equal lines:
// - the amount is the receivable or payable line's, where the browser read
//   the first line (a sale of Dr Cash 600 / Dr Receivable 400 / Cr Sales
//   1000 is 400 here, 600 there);
// - a sale with no receivable line, or a purchase with no payable line, is
//   left out, as a payment touching neither already was -- the browser
//   counted it in full.

export type StatementKind = 'sale' | 'purchase' | 'received' | 'paid';

// The transaction types a statement can show, each only when it touches the
// receivable or the payable.
export const STATEMENT_TRANSACTION_TYPES: TransactionType[] = ['SALE', 'PURCHASE', 'PAYMENT'];

// What the statement reads of a posting.
export interface StatementPosting {
  id: string;
  transactionType: TransactionType;
  transactionDate: Date;
  createdAt: Date;
  referenceNo: string | null;
  description: string | null;
  status: TransactionStatus;
  reversalOfId: string | null;
  entries: { entryType: EntryType; amount: Prisma.Decimal | string | number; account: { name: string; accountSubtype: string | null } }[];
}

export interface ContactStatementEntry {
  transactionId: string;
  date: Date;
  kind: StatementKind;
  referenceNo: string | null;
  description: string | null;
  // The wallet a payment went through; null for a sale or a purchase.
  wallet: string | null;
  amount: string;
  // What they owe after this row; negative when the business owes them.
  runningBalance: string;
  // Voided, or the reversal that voided it: shown, but not counted.
  cancelled: boolean;
}

export interface ContactStatementPage {
  openingBalance: string;
  // The opening balance plus everything counted before dateFrom.
  balanceBroughtForward: string;
  // This page's rows; their running balance carries over every earlier row.
  entries: ContactStatementEntry[];
  // The whole period's closing balance, the same on every page.
  closingBalance: string;
  // The balance before this page's first row and after its last.
  pageOpeningBalance: string;
  pageClosingBalance: string;
  // The newest counted sale or purchase, and payment either way, up to the
  // end of the period (an earlier one when the period has none).
  lastSale: ContactStatementEntry | null;
  lastPayment: ContactStatementEntry | null;
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export interface ContactStatement extends ContactStatementPage {
  contactId: string;
  contactName: string;
}

type PostingEntry = StatementPosting['entries'][number];

const SETTLEMENT_SUBTYPES = ['receivable', 'payable'];
const isSettlement = (entry: PostingEntry) => SETTLEMENT_SUBTYPES.includes(entry.account.accountSubtype ?? '');

// What a posting is to them, and the line that moves what they owe -- the
// one computeDirection() counts: a sale's receivable, a purchase's payable,
// a payment's receivable or else its payable. A payment that credits the
// receivable came in from them; one that debits the payable went out to
// them. Null when it never touched either, so it isn't on the statement.
function settlementOf(posting: StatementPosting): { kind: StatementKind; line: PostingEntry } | null {
  const receivable = posting.entries.find((entry) => entry.account.accountSubtype === 'receivable');
  const payable = posting.entries.find((entry) => entry.account.accountSubtype === 'payable');
  if (posting.transactionType === 'SALE') return receivable ? { kind: 'sale', line: receivable } : null;
  if (posting.transactionType === 'PURCHASE') return payable ? { kind: 'purchase', line: payable } : null;
  if (posting.transactionType !== 'PAYMENT') return null;
  if (receivable) return { kind: receivable.entryType === 'CREDIT' ? 'received' : 'paid', line: receivable };
  if (payable) return { kind: payable.entryType === 'DEBIT' ? 'paid' : 'received', line: payable };
  return null;
}

interface Line {
  posting: StatementPosting;
  kind: StatementKind;
  amount: Prisma.Decimal;
  // What it adds to what they owe: nothing when cancelled.
  delta: Prisma.Decimal;
  cancelled: boolean;
  wallet: string | null;
}

function lineOf(posting: StatementPosting): Line | null {
  const settlement = settlementOf(posting);
  if (!settlement) return null;
  const { kind } = settlement;
  const amount = new Prisma.Decimal(settlement.line.amount);
  const cancelled = posting.status === 'VOIDED' || posting.reversalOfId !== null;
  const wallet = kind === 'received' || kind === 'paid' ? (posting.entries.find((entry) => !isSettlement(entry))?.account.name ?? null) : null;
  const delta = cancelled ? new Prisma.Decimal(0) : kind === 'sale' || kind === 'paid' ? amount : amount.negated();
  return { posting, kind, amount, delta, cancelled, wallet };
}

// Oldest first; the id settles a tie, so a page boundary never moves.
const byDate = (a: StatementPosting, b: StatementPosting) =>
  a.transactionDate.getTime() - b.transactionDate.getTime() || a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const linesOf = (postings: StatementPosting[]): Line[] => [...postings].sort(byDate).flatMap((posting) => lineOf(posting) ?? []);

// `prior` is everything before the period (empty without a dateFrom),
// `period` everything in it.
export function contactStatement(input: {
  openingBalance: Prisma.Decimal | string | number;
  prior: StatementPosting[];
  period: StatementPosting[];
  page: number;
  limit: number;
}): ContactStatementPage {
  const opening = new Prisma.Decimal(input.openingBalance);
  const prior = linesOf(input.prior);
  const lines = [...prior, ...linesOf(input.period)];

  let running = opening;
  const rows = lines.map((line) => {
    running = running.plus(line.delta);
    const entry: ContactStatementEntry = {
      transactionId: line.posting.id,
      date: line.posting.transactionDate,
      kind: line.kind,
      referenceNo: line.posting.referenceNo,
      description: line.posting.description,
      wallet: line.wallet,
      amount: line.amount.toFixed(2),
      runningBalance: running.toFixed(2),
      cancelled: line.cancelled,
    };
    return { line, entry, running };
  });

  const broughtForward = prior.length > 0 ? rows[prior.length - 1].running : opening;
  const inPeriod = rows.slice(prior.length);
  const page = Math.max(1, input.page);
  const start = Math.min((page - 1) * input.limit, inPeriod.length);
  const end = Math.min(start + input.limit, inPeriod.length);
  const balanceAfter = (count: number) => (count === 0 ? broughtForward : inPeriod[count - 1].running);
  const newest = (kinds: StatementKind[]) => [...rows].reverse().find(({ line }) => !line.cancelled && kinds.includes(line.kind))?.entry ?? null;

  return {
    openingBalance: opening.toFixed(2),
    balanceBroughtForward: broughtForward.toFixed(2),
    entries: inPeriod.slice(start, end).map(({ entry }) => entry),
    closingBalance: balanceAfter(inPeriod.length).toFixed(2),
    pageOpeningBalance: balanceAfter(start).toFixed(2),
    pageClosingBalance: balanceAfter(end).toFixed(2),
    lastSale: newest(['sale', 'purchase']),
    lastPayment: newest(['received', 'paid']),
    meta: { page, limit: input.limit, total: inPeriod.length, totalPages: Math.ceil(inPeriod.length / input.limit) },
  };
}
