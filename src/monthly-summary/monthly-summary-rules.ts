import { formatTaka, type BillingLocale } from '../billing/billing-text.js';

const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

// The summary goes from 08:00 Dhaka on the 1st; a server that was down
// then catches up later that day or on the 2nd or 3rd. After that the
// month is skipped: a summary arriving mid-month is more noise than news.
export const SEND_FROM_HOUR = 8;
export const LAST_SEND_DAY = 3;

// The 'YYYY-MM' of the month before the given Dhaka year/month.
export function previousMonthKey(year: number, month: number): string {
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  return `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
}

// The month whose summary is due at `now` ('YYYY-MM', last month on the
// Dhaka calendar), or null outside the sending days.
export function dueSummaryMonth(now: Date): string | null {
  const local = new Date(now.getTime() + DHAKA_OFFSET_MS);
  const day = local.getUTCDate();
  if (day > LAST_SEND_DAY) return null;
  if (day === 1 && local.getUTCHours() < SEND_FROM_HOUR) return null;
  return previousMonthKey(local.getUTCFullYear(), local.getUTCMonth() + 1);
}

// The month's bounds as UTC-midnight dates, the shape a `@db.Date` column
// (Transaction.transactionDate) stores -- the same bounds the reports use
// (dhakaMonthRange).
export function monthBounds(monthKey: string): { start: Date; end: Date } {
  const [year, month] = monthKey.split('-').map(Number);
  return { start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month, 1)) };
}

// The instant the month after `monthKey` began in Dhaka: accounts created
// after it have no month to sum up yet.
export function monthEndInstant(monthKey: string): Date {
  return new Date(monthBounds(monthKey).end.getTime() - DHAKA_OFFSET_MS);
}

const MONTH_NAMES: Record<BillingLocale, string[]> = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  bn: ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'],
};
const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

// "October 2026" / "অক্টোবর ২০২৬"
export function monthLabel(monthKey: string, locale: BillingLocale): string {
  const [year, month] = monthKey.split('-');
  const yearText = locale === 'bn' ? year.replace(/\d/g, (digit) => BN_DIGITS[Number(digit)]) : year;
  return `${MONTH_NAMES[locale][Number(month) - 1]} ${yearText}`;
}

export interface SummaryFigures {
  incomePaisa: number;
  expensesPaisa: number;
  netPaisa: number;
  savedPaisa: number;
  // The largest expense categories, biggest first, at most three.
  topExpenses: { name: string; paisa: number }[];
}

export const TOP_EXPENSES = 3;

// Last month's figures from the totals the service reads: income, each
// expense category's total, and what went into savings goals.
export function summaryFigures(incomePaisa: number, expenseCategories: { name: string; paisa: number }[], savedPaisa: number): SummaryFigures {
  const expensesPaisa = expenseCategories.reduce((sum, row) => sum + row.paisa, 0);
  const topExpenses = expenseCategories
    .filter((row) => row.paisa > 0)
    .sort((a, b) => b.paisa - a.paisa || a.name.localeCompare(b.name))
    .slice(0, TOP_EXPENSES);
  return { incomePaisa, expensesPaisa, netPaisa: incomePaisa - expensesPaisa, savedPaisa, topExpenses };
}

// A month with nothing in it gets no email.
export const hasActivity = (figures: SummaryFigures): boolean => figures.incomePaisa > 0 || figures.expensesPaisa > 0 || figures.savedPaisa > 0;

// The amounts as the email prints them; net without its sign (the label
// says which way it went).
export function formattedFigures(figures: SummaryFigures, locale: BillingLocale, nameOf: (name: string) => string = (name) => name) {
  return {
    income: formatTaka(figures.incomePaisa, locale),
    expenses: formatTaka(figures.expensesPaisa, locale),
    net: formatTaka(Math.abs(figures.netPaisa), locale),
    netNegative: figures.netPaisa < 0,
    saved: formatTaka(figures.savedPaisa, locale),
    topExpenses: figures.topExpenses.map((row) => ({ name: nameOf(row.name), amount: formatTaka(row.paisa, locale) })),
  };
}
