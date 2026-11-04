import { dhakaDateKey } from '../common/dhaka.js';

// What happened with each loan contact and in the month: every entry --
// a loan given or taken, money back, or profit paid or received -- with its
// date, worked out from the postings alone. Pure, so it is tested on its own.

export type LoanEntryKind = 'GAVE' | 'TOOK' | 'GOT_BACK' | 'PAID_BACK' | 'PROFIT_PAID' | 'PROFIT_RECEIVED';

export interface LoanActivityPosting {
  contactId: string;
  kind: LoanEntryKind;
  // The amount, in taka.
  amount: number;
  date: Date;
  createdAt: Date;
}

// The month's money, by what it was for (Dashboard's This month).
export interface LoanMonth {
  lent: string;
  borrowed: string;
  gotBack: string;
  paidBack: string;
  profitPaid: string;
  profitReceived: string;
  entries: number;
}

export interface LoanContactActivity {
  entries: number;
  // The newest entry: what it was and its day ("2026-09-16").
  last: { kind: LoanEntryKind; date: string } | null;
}

const MONTH_FIELD: Record<LoanEntryKind, keyof Omit<LoanMonth, 'entries'>> = {
  GAVE: 'lent',
  TOOK: 'borrowed',
  GOT_BACK: 'gotBack',
  PAID_BACK: 'paidBack',
  PROFIT_PAID: 'profitPaid',
  PROFIT_RECEIVED: 'profitReceived',
};

// `month` is an Asia/Dhaka "YYYY-MM".
export function loanActivity(postings: LoanActivityPosting[], month: string): { month: LoanMonth; byContact: Map<string, LoanContactActivity> } {
  const sums: Record<keyof Omit<LoanMonth, 'entries'>, number> = { lent: 0, borrowed: 0, gotBack: 0, paidBack: 0, profitPaid: 0, profitReceived: 0 };
  let entries = 0;
  const byContact = new Map<string, LoanContactActivity & { at: number }>();
  for (const posting of postings) {
    const day = dhakaDateKey(posting.date);
    if (day.slice(0, 7) === month) {
      sums[MONTH_FIELD[posting.kind]] += posting.amount;
      entries += 1;
    }
    const seen = byContact.get(posting.contactId);
    // Newest by its day, then by when it was entered.
    const newer = !seen?.last || day > seen.last.date || (day === seen.last.date && posting.createdAt.getTime() >= seen.at);
    byContact.set(posting.contactId, {
      entries: (seen?.entries ?? 0) + 1,
      last: newer ? { kind: posting.kind, date: day } : (seen?.last ?? null),
      at: newer ? posting.createdAt.getTime() : (seen?.at ?? 0),
    });
  }
  const money = (value: number) => value.toFixed(2);
  return {
    month: {
      lent: money(sums.lent),
      borrowed: money(sums.borrowed),
      gotBack: money(sums.gotBack),
      paidBack: money(sums.paidBack),
      profitPaid: money(sums.profitPaid),
      profitReceived: money(sums.profitReceived),
      entries,
    },
    byContact: new Map([...byContact].map(([contactId, { entries: count, last }]) => [contactId, { entries: count, last }])),
  };
}
