import type { TransactionType } from '@prisma/client';

// What a ledger row is, in the words the Balance board's Type column uses:
// where the money came from or went to, from the ledger account's side.
export const LEDGER_KINDS = [
  'INCOME',
  'EXPENSE',
  'TRANSFER',
  'SAVINGS',
  'SAVINGS_WITHDRAW',
  'LOAN_OUT',
  'LOAN_IN',
  'PAYMENT_IN',
  'PAYMENT_OUT',
  'ASSET_PURCHASE',
  'ASSET_SALE',
  'ADJUSTMENT',
  'OTHER',
] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

export interface LedgerLeg {
  accountName: string;
  accountSubtype: string | null;
  // The other legs' category (a quick entry keeps it on the category's leg).
  categoryId: string | null;
}

export interface LedgerKindInput {
  transactionType: TransactionType;
  // From the ledger account's side: in raises its balance, out lowers it.
  direction: 'in' | 'out';
  // The ledger account's own subtype ("savings" for a savings wallet).
  accountSubtype: string | null;
  // The transaction's other legs.
  legs: LedgerLeg[];
  // The contact a loan or a Dena-Pawna payment is with.
  contact: { name: string; category: 'BUSINESS' | 'LOAN' } | null;
  // The asset bought or sold by this transaction.
  asset: { name: string; side: 'PURCHASE' | 'SALE' } | null;
  // The savings goal this money moved for.
  goalName: string | null;
  adjustmentSubtype: string;
}

const DEBT_SUBTYPES = ['receivable', 'payable'];

// The row's kind and the name its To / From column shows (a category, an
// account, a person, an asset or a goal; null when the kind says it all).
export function ledgerKind(input: LedgerKindInput): { kind: LedgerKind; party: string | null } {
  const { transactionType, direction, legs } = input;
  const out = direction === 'out';
  const counter = legs[0]?.accountName ?? null;
  const category = legs.find((leg) => leg.categoryId)?.categoryId ?? null;

  if (legs.some((leg) => leg.accountSubtype === input.adjustmentSubtype)) return { kind: 'ADJUSTMENT', party: null };
  if (input.asset) return { kind: input.asset.side === 'PURCHASE' ? 'ASSET_PURCHASE' : 'ASSET_SALE', party: input.asset.name };

  if (transactionType === 'TRANSFER') {
    const selfSavings = input.accountSubtype === 'savings';
    const counterSavings = legs.some((leg) => leg.accountSubtype === 'savings');
    // Money moving into or out of a savings wallet is a goal's: into savings
    // from a wallet's side reads as Savings, back out as Savings withdraw.
    if (selfSavings !== counterSavings) {
      const intoSavings = selfSavings ? !out : out;
      return { kind: intoSavings ? 'SAVINGS' : 'SAVINGS_WITHDRAW', party: input.goalName ?? counter };
    }
    return { kind: 'TRANSFER', party: counter };
  }

  if (input.contact && legs.some((leg) => leg.accountSubtype && DEBT_SUBTYPES.includes(leg.accountSubtype))) {
    const loan = input.contact.category === 'LOAN';
    return { kind: loan ? (out ? 'LOAN_OUT' : 'LOAN_IN') : out ? 'PAYMENT_OUT' : 'PAYMENT_IN', party: input.contact.name };
  }

  if (transactionType === 'INCOME') return { kind: 'INCOME', party: category ?? counter };
  if (transactionType === 'EXPENSE') return { kind: 'EXPENSE', party: category ?? counter };
  return { kind: 'OTHER', party: legs.length ? legs.map((leg) => leg.accountName).join(', ') : null };
}

// Whether a row matches the ledger's search: its note, reference, the name
// in its To / From column, or its amount ("5000" finds ৳ 5,000.00).
export function ledgerRowMatches(
  row: { description: string | null; referenceNo: string | null; party: string | null; chargeFor: string | null; amount: string },
  search: string,
): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  if ([row.description, row.referenceNo, row.party, row.chargeFor].some((value) => !!value && value.toLowerCase().includes(needle))) return true;
  // An amount is typed with or without its grouping commas.
  const figure = needle.replace(/,/g, '');
  return /^\d+(\.\d*)?$/.test(figure) && (row.amount.startsWith(figure) || row.amount.replace(/\.00$/, '') === figure);
}
