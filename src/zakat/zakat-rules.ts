import type { Prisma, ZakatDateMode, ZakatMetal } from '@prisma/client';
import { dayOf, figuresOf, type EntryKind } from '../investments/investment-figures.js';
import { toPaisa } from '../billing/pricing.js';

// Zakat's arithmetic and calendar, pure so it is tested on its own. Money is
// in paisa (whole numbers); prices are whole taka per vori.

// 1 vori (tola) = 11.664 grams.
export const VORI_GRAMS = 11.664;
// Nisab: 52.5 vori of silver, or 7.5 vori of gold.
export const NISAB_SILVER_VORI = 52.5;
export const NISAB_GOLD_VORI = 7.5;
// 2.5 %.
export const ZAKAT_PCT = 2.5;

// BAJUS prices per vori from 31 Oct 2026, the platform's until an admin
// enters newer ones. The other gold karats move with 22 karat in these
// proportions (BAJUS prices them together).
export const BAJUS_DEFAULT = { gold22: 217592, silver22: 3499, on: '2026-10-31' };
const GOLD_KARATS: Record<Exclude<ZakatMetal, 'SILVER_22'>, number> = {
  GOLD_22: 217592,
  GOLD_21: 207794,
  GOLD_18: 178459,
  GOLD_TRADITIONAL: 145800,
};

// Price per vori of every metal, from the 22 karat gold and silver prices.
export function pricesPerVori(gold22: number, silver22: number): Record<ZakatMetal, number> {
  const scale = gold22 / GOLD_KARATS.GOLD_22;
  return {
    GOLD_22: gold22,
    GOLD_21: Math.round(GOLD_KARATS.GOLD_21 * scale),
    GOLD_18: Math.round(GOLD_KARATS.GOLD_18 * scale),
    GOLD_TRADITIONAL: Math.round(GOLD_KARATS.GOLD_TRADITIONAL * scale),
    SILVER_22: silver22,
  };
}

// What `weightVori` of a metal is worth today, in paisa.
export const metalValuePaisa = (weightVori: number, pricePerVori: number): number => Math.round(weightVori * pricePerVori * 100);

export const nisabPaisa = (basis: 'SILVER' | 'GOLD', gold22: number, silver22: number): number =>
  basis === 'SILVER' ? Math.round(NISAB_SILVER_VORI * silver22 * 100) : Math.round(NISAB_GOLD_VORI * gold22 * 100);

// 2.5 % of what is owned after debts, when that reaches nisab; nothing below.
export function zakatPaisa(netPaisa: number, nisab: number): number {
  if (netPaisa <= 0 || netPaisa < nisab) return 0;
  return Math.round((netPaisa * ZAKAT_PCT) / 100);
}

// --- The calendar ---

const DAY_MS = 24 * 60 * 60 * 1000;
const isoOf = (time: number) => new Date(time).toISOString().slice(0, 10);
const timeOf = (day: string) => Date.parse(`${day}T00:00:00Z`);

export const daysBetween = (from: string, to: string): number => Math.round((timeOf(to) - timeOf(from)) / DAY_MS);

// The Umm al-Qura calendar, as the runtime's ICU has it.
const HIJRI = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { timeZone: 'UTC', day: 'numeric', month: 'numeric', year: 'numeric' });

export function hijriOf(day: string): { year: number; month: number; day: number } {
  const parts = Object.fromEntries(HIJRI.formatToParts(new Date(timeOf(day))).map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

// The first day on or after `today` that is the 1st of the Hijri month
// (9 = Ramadan, 1 = Muharram), and its Hijri year.
export function nextHijriFirst(today: string, month: number): { date: string; hijriYear: number } {
  for (let time = timeOf(today), n = 0; n < 400; n++, time += DAY_MS) {
    const day = isoOf(time);
    const hijri = hijriOf(day);
    if (hijri.month === month && hijri.day === 1) return { date: day, hijriYear: hijri.year };
  }
  throw new Error(`No Hijri month ${month} within a year of ${today}`);
}

// The next time a custom zakat date comes round: its month and day this
// year, or next year when it has passed (29 Feb falls back to 28 Feb).
export function nextCustomDate(today: string, customDate: string): string {
  const [, m, d] = customDate.split('-').map(Number);
  const year = Number(today.slice(0, 4));
  const onYear = (y: number) => {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return `${y}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
  };
  const thisYear = onYear(year);
  return thisYear >= today ? thisYear : onYear(year + 1);
}

export interface DueDate {
  date: string;
  // 1448 for 1 Ramadan 1448; null for a custom date.
  hijriYear: number | null;
}

// When this zakat year is due, on the Dhaka calendar's today.
export function dueDateFor(mode: ZakatDateMode, customDate: string | null, today: string): DueDate {
  if (mode === 'CUSTOM' && customDate) return { date: nextCustomDate(today, customDate), hijriYear: null };
  const found = nextHijriFirst(today, mode === 'MUHARRAM' ? 1 : 9);
  return { date: found.date, hijriYear: found.hijriYear };
}

// Giving what is left in monthly parts until the due date: how many, and
// about how much each (rounded up, so the parts cover it).
export function monthlyParts(leftPaisa: number, daysLeft: number): { parts: number; perPart: number } {
  const parts = Math.max(1, Math.ceil(daysLeft / 30));
  return { parts, perPart: leftPaisa > 0 ? Math.ceil(leftPaisa / parts / 100) * 100 : 0 };
}

// --- Assets ---

export type AssetZakat = 'GOLD' | 'INVESTMENTS' | 'NOT_COUNTED';

// Where an asset's category puts it: jewellery, gold and silver are
// weighed; investments count at their value; the rest (land, a flat, a car,
// things in use) carries no zakat unless bought to sell.
export function assetZakatOf(category: string): AssetZakat {
  if (/jewel|gold|silver|গয়না|গহনা|সোনা|স্বর্ণ|রুপা/i.test(category)) return 'GOLD';
  if (/invest|share|stock|bond|fund|sanchay|বিনিয়োগ|শেয়ার|সঞ্চয়পত্র/i.test(category)) return 'INVESTMENTS';
  return 'NOT_COUNTED';
}

// --- Investments ---

// What an open investment counts for: the capital still in it (put in, less
// what came back and what was lost), in paisa. Its profit already reached a
// wallet, so it is not counted twice.
export function investmentCapitalPaisa(entries: { type: EntryKind; amount: Prisma.Decimal | number | string; date: Date }[]): number {
  return toPaisa(figuresOf(entries.map((entry) => ({ type: entry.type, amount: entry.amount, day: dayOf(entry.date) }))).capital);
}

// --- Debts ---

// What of a debt is taken off when only the next 12 months count: what was
// owed at the start plus every unpaid part due within a year (or with no
// due date, so due now).
export function debtWithinYearPaisa(openingRemainingPaisa: number, parts: { remainingPaisa: number; dueDate: string | null }[], today: string): number {
  const yearOn = isoOf(timeOf(today) + 365 * DAY_MS);
  const due = parts.filter((part) => part.remainingPaisa > 0 && (!part.dueDate || part.dueDate <= yearOn)).reduce((sum, part) => sum + part.remainingPaisa, 0);
  return Math.max(0, openingRemainingPaisa) + due;
}
