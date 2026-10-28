import type { PaymentGateway } from '@prisma/client';
import { dhakaDateKey } from '../common/dhaka.js';

export type BillingLocale = 'en' | 'bn';

export const localeOf = (preferredLanguage: string | null | undefined): BillingLocale => (preferredLanguage === 'BN' ? 'bn' : 'en');

// How the app and the admin panel print a payment's id: "PAY-" and the
// first eight characters, upper case.
export const displayPaymentId = (id: string): string => `PAY-${id.slice(0, 8).toUpperCase()}`;

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
const toBnDigits = (text: string): string => text.replace(/\d/g, (digit) => BN_DIGITS[Number(digit)]);

// Lakh/crore grouping (12,50,000), the paisa only when there are some.
export function formatTaka(paisa: number, locale: BillingLocale = 'en'): string {
  const negative = paisa < 0;
  const whole = Math.floor(Math.abs(paisa) / 100);
  const fraction = Math.abs(paisa) % 100;
  const digits = String(whole);
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  const grouped = rest ? `${rest},${last3}` : last3;
  const text = `${negative ? '-' : ''}${grouped}${fraction ? `.${String(fraction).padStart(2, '0')}` : ''}`;
  return locale === 'bn' ? toBnDigits(text) : text;
}

const METHOD_NAMES: Record<PaymentGateway, Record<BillingLocale, string>> = {
  BKASH: { en: 'bKash', bn: 'বিকাশ' },
  NAGAD: { en: 'Nagad', bn: 'নগদ' },
  SSLCOMMERZ: { en: 'SSLCommerz', bn: 'SSLCommerz' },
  CARD: { en: 'card', bn: 'কার্ড' },
  MANUAL: { en: 'bank or mobile banking', bn: 'ব্যাংক বা মোবাইল ব্যাংকিং' },
};

export const methodName = (gateway: PaymentGateway, locale: BillingLocale): string => METHOD_NAMES[gateway][locale];

// Fills the admin's instruction text: {amount}, {reference} and {method}.
// An unknown {word} is left as it is.
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);
}

const MONTHS: Record<BillingLocale, string[]> = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  bn: ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'],
};

// "27 Oct 2026" / "২৭ অক্টোবর ২০২৬", on the Dhaka calendar.
export function dateLabel(date: Date, locale: BillingLocale): string {
  const [year, month, day] = dhakaDateKey(date).split('-');
  const text = `${Number(day)} ${MONTHS[locale][Number(month) - 1]} ${year}`;
  return locale === 'bn' ? toBnDigits(text) : text;
}
