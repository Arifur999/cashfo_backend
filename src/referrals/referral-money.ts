import type { PayoutMethodType, PayoutStatus } from '@prisma/client';
import { dhakaDateKey } from '../common/dhaka.js';

// Referral money is worked out in paisa (whole numbers), like billing's
// prices (billing/pricing.ts toPaisa / fromPaisa).

// The referrer's commission: `ratePct` % of what the friend paid, rounded
// down to whole taka (৳ 2,700 at 20 % -> ৳ 540; ৳ 299 at 20 % -> ৳ 59).
export function commissionPaisa(paidPaisa: number, ratePct: number): number {
  if (!(paidPaisa > 0) || !(ratePct > 0)) return 0;
  // The rate has at most two decimals (Decimal(5,2)); kept whole so the
  // product stays exact.
  const rateBasis = Math.round(ratePct * 100);
  return Math.floor((paidPaisa * rateBasis) / 1_000_000) * 100;
}

export const OPEN_PAYOUT_STATUSES: readonly PayoutStatus[] = ['REQUESTED', 'APPROVED'];

// Most commission lines one withdrawal can hold.
export const MAX_WITHDRAWAL_LINES = 500;

// --- Dates ---

const DAY_MS = 24 * 60 * 60 * 1000;

// The Dhaka date `days` working days after `from` (the team works Sunday to
// Thursday; Friday and Saturday are off). A request on Thursday 1 Oct with
// 3 days is due on Tuesday 6 Oct.
export function addWorkingDays(from: Date, days: number): string {
  const [y, m, d] = dhakaDateKey(from).split('-').map(Number);
  let cursor = Date.UTC(y, m - 1, d);
  let left = Math.max(0, days);
  while (left > 0) {
    cursor += DAY_MS;
    const weekday = new Date(cursor).getUTCDay();
    if (weekday !== 5 && weekday !== 6) left--;
  }
  return new Date(cursor).toISOString().slice(0, 10);
}

// "2026-W43" on the Dhaka calendar: friend reminders go at most once a week.
export function isoWeekKey(date: Date): string {
  const [y, m, d] = dhakaDateKey(date).split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((day.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// --- People, names and numbers ---

export const displayPayoutId = (number: number): string => `WD-${number}`;

// Lowercase, single spaces, no dots or commas: "Md. Khaled  Mahmud" and
// "md khaled mahmud" match.
export const normaliseName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[.,'`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const namesMatch = (a: string | null | undefined, b: string | null | undefined): boolean =>
  Boolean(a && b) && normaliseName(a as string) === normaliseName(b as string);

// A Bangladeshi mobile number as 01XXXXXXXXX: spaces and dashes dropped,
// +880 / 880 turned into 0. Anything else comes back with only its digits.
export function normaliseMobile(raw: string): string {
  let digits = raw.replace(/[^\d]/g, '');
  if (digits.startsWith('880')) digits = `0${digits.slice(3)}`;
  return digits;
}

const MOBILE = /^01[3-9]\d{8}$/;
// A Rocket account is the mobile number plus a check digit.
const ROCKET = /^01[3-9]\d{8}\d?$/;

// Whether a stored wallet number fits its service.
export function walletNumberFits(type: PayoutMethodType, number: string | null | undefined): boolean {
  if (type === 'BANK') return true;
  if (!number) return false;
  return type === 'ROCKET' ? ROCKET.test(number) : MOBILE.test(number);
}

// The last ten digits, so 01711482915, +8801711482915 and a Rocket number's
// first eleven digits compare equal.
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const tail = (raw: string) => {
    const digits = normaliseMobile(raw);
    const mobile = digits.length === 12 && ROCKET.test(digits) ? digits.slice(0, 11) : digits;
    return mobile.slice(-10);
  };
  const x = tail(a);
  const y = tail(b);
  return x.length === 10 && x === y;
}

// One mailbox under its many spellings: case, a "+tag", and for Gmail the
// dots in the name.
export function canonicalEmail(email: string): string {
  const [local = '', domain = ''] = email.trim().toLowerCase().split('@');
  const base = local.split('+')[0];
  const gmail = domain === 'gmail.com' || domain === 'googlemail.com';
  return `${gmail ? base.replace(/\./g, '') : base}@${gmail ? 'gmail.com' : domain}`;
}

// A sign-up with the referrer's own phone or mailbox: self-referral.
export function looksLikeSamePerson(referrer: { email: string; phone: string | null }, friend: { email: string; phone: string | null }): boolean {
  return canonicalEmail(referrer.email) === canonicalEmail(friend.email) || samePhone(referrer.phone, friend.phone);
}

// "k***@gmail.com"
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
}

// "01711-•••915"
export function maskPhone(phone: string): string {
  const digits = normaliseMobile(phone);
  if (digits.length < 8) return '•••';
  return `${digits.slice(0, 5)}-•••${digits.slice(-3)}`;
}
