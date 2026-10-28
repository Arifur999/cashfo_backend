import { dateLabel, type BillingLocale } from '../billing/billing-text.js';

// Settings > Security > Alerts: the rules, kept pure so they can be tested.

// "Warn me about unusual sign-in tries": this many wrong passwords (or
// wrong two-step codes) within the window, and at most one warning per gap.
export const FAILED_TRIES_WINDOW_MS = 15 * 60 * 1000;
export const FAILED_TRIES_THRESHOLD = 5;
export const FAILED_TRIES_ALERT_GAP_MS = 60 * 60 * 1000;
// The LoginAttempt.failureReason values that count: someone typing at the
// account, not a suspended or unknown one.
export const FAILED_TRY_REASONS = ['invalid_password', 'two_step_failed'];

// The first sign-in of an account this new is its signup: the verification
// email goes then, instead of a new-device alert. An older account signing
// in for the first time since devices were recorded gets neither.
export const SIGNUP_WINDOW_MS = 24 * 60 * 60 * 1000;

// A device counts as known once any earlier session of the account had the
// same label ("Chrome on Windows"). The IP address alone changes too often
// (mobile data, a new Wi-Fi) to be worth an email each time.
export function isKnownDevice(deviceLabel: string, earlierLabels: readonly string[]): boolean {
  return earlierLabels.includes(deviceLabel);
}

// Whether the failures so far call for a warning now.
export function failedTriesAlertDue(count: number, lastAlertedAt: Date | null, now: Date): boolean {
  if (count < FAILED_TRIES_THRESHOLD) return false;
  return !lastAlertedAt || now.getTime() - lastAlertedAt.getTime() >= FAILED_TRIES_ALERT_GAP_MS;
}

// The bell row's key: one per hour at most, like the email.
export const failedTriesKey = (now: Date): string => `failed-tries:${now.toISOString().slice(0, 13)}`;

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

// "28 Oct 2026, 3:05 pm" / "২৮ অক্টোবর ২০২৬, বিকাল ৩:০৫" on the Dhaka clock, for
// the alert emails.
export function dhakaTimeLabel(date: Date, locale: BillingLocale): string {
  const local = new Date(date.getTime() + DHAKA_OFFSET_MS);
  const hours = local.getUTCHours();
  const minutes = String(local.getUTCMinutes()).padStart(2, '0');
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  if (locale === 'en') return `${dateLabel(date, 'en')}, ${hour12}:${minutes} ${hours < 12 ? 'am' : 'pm'}`;
  const part = hours < 4 ? 'রাত' : hours < 6 ? 'ভোর' : hours < 12 ? 'সকাল' : hours < 15 ? 'দুপুর' : hours < 18 ? 'বিকাল' : hours < 20 ? 'সন্ধ্যা' : 'রাত';
  return `${dateLabel(date, 'bn')}, ${part} ${`${hour12}:${minutes}`.replace(/\d/g, (digit) => BN_DIGITS[Number(digit)])}`;
}
