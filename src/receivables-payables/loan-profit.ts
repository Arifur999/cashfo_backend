import { dhakaDateKey } from '../common/dhaka.js';

// Profit (or interest) on a loan: an income or expense posted with the
// loan's contact. It never moves the loan balance -- only the principal
// postings on Accounts Receivable / Payable do -- so it is summed apart.
// Pure, so it is tested on its own.

export interface ProfitPosting {
  contactId: string;
  date: Date;
  // The amount, in taka.
  amount: number;
  // An expense is profit paid; an income, profit received.
  paid: boolean;
}

export interface ProfitTotals {
  // All-time, per contact.
  byContact: Map<string, { paid: number; received: number }>;
  // Profit paid in the Asia/Dhaka year given.
  paidThisYear: number;
  // Who most of this year's profit went to, and about how much a month
  // (their total over the months they paid in).
  top: { contactId: string; monthly: number } | null;
}

export function profitTotals(postings: ProfitPosting[], year: number): ProfitTotals {
  const byContact = new Map<string, { paid: number; received: number }>();
  const thisYear = new Map<string, { total: number; months: Set<string> }>();
  let paidThisYear = 0;
  for (const posting of postings) {
    const totals = byContact.get(posting.contactId) ?? { paid: 0, received: 0 };
    if (posting.paid) totals.paid += posting.amount;
    else totals.received += posting.amount;
    byContact.set(posting.contactId, totals);

    const day = dhakaDateKey(posting.date);
    if (!posting.paid || day.slice(0, 4) !== String(year)) continue;
    paidThisYear += posting.amount;
    const contact = thisYear.get(posting.contactId) ?? { total: 0, months: new Set<string>() };
    contact.total += posting.amount;
    contact.months.add(day.slice(0, 7));
    thisYear.set(posting.contactId, contact);
  }
  let top: ProfitTotals['top'] = null;
  let most = 0;
  for (const [contactId, contact] of thisYear) {
    if (contact.total > most) {
      most = contact.total;
      top = { contactId, monthly: Math.round((contact.total / contact.months.size) * 100) / 100 };
    }
  }
  return { byContact, paidThisYear: Math.round(paidThisYear * 100) / 100, top };
}
