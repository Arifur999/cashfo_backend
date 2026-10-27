import type { PayoutMethodType, PayoutStatus, ReferralStatus } from '@prisma/client';
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

// One commission (or old sign-up bonus) as the balance sees it.
export interface CommissionEntry {
  id: string;
  status: ReferralStatus;
  commissionPaisa: number;
  paidOutPaisa: number;
  availableAt: Date | null;
  createdAt: Date;
}

export interface PayoutEntry {
  id: string;
  number: number;
  status: PayoutStatus;
  amountPaisa: number;
  createdAt: Date;
}

export interface Balances {
  // What the member can ask for now: available commissions not yet paid
  // out, less what open requests have set aside.
  availablePaisa: number;
  // Set aside by REQUESTED and APPROVED requests.
  reservedPaisa: number;
  // Commissions still inside the refund window.
  pendingPaisa: number;
  pendingNextAt: Date | null;
  // Paid out so far (payouts and old in-app withdrawals).
  paidOutPaisa: number;
  // available + reserved + paid out.
  totalEarnedPaisa: number;
}

export const OPEN_PAYOUT_STATUSES: readonly PayoutStatus[] = ['REQUESTED', 'APPROVED'];

const remainingOf = (row: CommissionEntry): number => Math.max(0, row.commissionPaisa - row.paidOutPaisa);

export function referralBalances(rows: CommissionEntry[], payouts: Pick<PayoutEntry, 'status' | 'amountPaisa'>[]): Balances {
  let gross = 0;
  let pending = 0;
  let paidOut = 0;
  let pendingNextAt: Date | null = null;
  for (const row of rows) {
    if (row.status === 'AVAILABLE') gross += remainingOf(row);
    if (row.status === 'AVAILABLE' || row.status === 'PAID_OUT') paidOut += Math.min(row.paidOutPaisa, row.commissionPaisa);
    if (row.status === 'PENDING') {
      pending += row.commissionPaisa;
      if (row.availableAt && (!pendingNextAt || row.availableAt < pendingNextAt)) pendingNextAt = row.availableAt;
    }
  }
  const reserved = payouts.filter((p) => OPEN_PAYOUT_STATUSES.includes(p.status)).reduce((sum, p) => sum + p.amountPaisa, 0);
  const available = Math.max(0, gross - reserved);
  return {
    availablePaisa: available,
    reservedPaisa: reserved,
    pendingPaisa: pending,
    pendingNextAt,
    paidOutPaisa: paidOut,
    totalEarnedPaisa: available + reserved + paidOut,
  };
}

// The order money leaves the balance: the oldest available first.
export function fifoOrder<T extends CommissionEntry>(rows: T[]): T[] {
  const time = (date: Date | null) => date?.getTime() ?? 0;
  return rows
    .filter((row) => row.status === 'AVAILABLE' && remainingOf(row) > 0)
    .sort((a, b) => time(a.availableAt) - time(b.availableAt) || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
}

export interface Allocation {
  referralId: string;
  paisa: number;
  // The commission is fully paid out after this.
  closes: boolean;
}

// Takes `amountPaisa` from the available commissions, oldest first. Null
// when they don't hold that much.
export function allocateFifo(rows: CommissionEntry[], amountPaisa: number): Allocation[] | null {
  const out: Allocation[] = [];
  let left = amountPaisa;
  for (const row of fifoOrder(rows)) {
    if (left <= 0) break;
    const remaining = remainingOf(row);
    const take = Math.min(remaining, left);
    out.push({ referralId: row.id, paisa: take, closes: take === remaining });
    left -= take;
  }
  return left > 0 ? null : out;
}

// Which commissions an open request is expected to take, if the requests
// before it (by number) are paid first. For the admin's "why this member
// is owed this" before Mark paid records the real allocation.
export function projectBacking(rows: CommissionEntry[], openPayouts: Pick<PayoutEntry, 'id' | 'number' | 'amountPaisa'>[], payoutId: string): Allocation[] {
  const queue = fifoOrder(rows).map((row) => ({ id: row.id, left: remainingOf(row) }));
  const ordered = [...openPayouts].sort((a, b) => a.number - b.number);
  let index = 0;
  for (const payout of ordered) {
    let need = payout.amountPaisa;
    const taken: Allocation[] = [];
    while (need > 0 && index < queue.length) {
      const slot = queue[index];
      const take = Math.min(slot.left, need);
      if (take > 0) taken.push({ referralId: slot.id, paisa: take, closes: take === slot.left });
      slot.left -= take;
      need -= take;
      if (slot.left === 0) index++;
    }
    if (payout.id === payoutId) return taken;
  }
  return [];
}

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

// The statuses the old referral page knew, for GET /api/referrals'
// recentReferrals (kept as it was): not yet earned, earned, withdrawn.
export function legacyStatusOf(status: ReferralStatus): 'PENDING' | 'CONFIRMED' | 'WITHDRAWN' | 'CANCELLED' {
  if (status === 'AVAILABLE' || status === 'CONFIRMED') return 'CONFIRMED';
  if (status === 'PAID_OUT' || status === 'WITHDRAWN') return 'WITHDRAWN';
  if (status === 'CANCELLED') return 'CANCELLED';
  return 'PENDING';
}
