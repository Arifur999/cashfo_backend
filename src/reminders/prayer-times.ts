import { CalculationMethod, Coordinates, Madhab, PrayerTimes } from 'adhan';
import type { AsrSchool } from '@prisma/client';

// Prayer, Sehri and Iftar times on the server, worked out exactly as the
// customer app does (cashfo/src/lib/customer/prayerTimes.ts and
// habitDisplay.ts's hijriParts()), so a reminder says the time the page shows.

export interface PrayerSettingsInput {
  latitude: number;
  longitude: number;
  // An adhan calculation method name.
  method: string;
  asrSchool: AsrSchool;
  // -1, 0 or 1: the Hijri date runs a day earlier or later than calculated.
  hijriAdjust: number;
}

// Before anyone saves their own (NamazService's DEFAULT_SETTINGS).
export const DEFAULT_PRAYER_SETTINGS: PrayerSettingsInput = { latitude: 23.8103, longitude: 90.4125, method: 'Karachi', asrSchool: 'HANAFI', hijriAdjust: 0 };

export interface DayPrayerTimes {
  fajr: Date;
  dhuhr: Date;
  asr: Date;
  maghrib: Date;
  isha: Date;
}

// The five prayers of a "YYYY-MM-DD" day for these settings.
export function prayerTimesFor(settings: PrayerSettingsInput, day: string): DayPrayerTimes {
  const [year, month, date] = day.split('-').map(Number);
  const method = Object.hasOwn(CalculationMethod, settings.method)
    ? CalculationMethod[settings.method as keyof typeof CalculationMethod]
    : CalculationMethod.Karachi;
  const params = method();
  params.madhab = settings.asrSchool === 'HANAFI' ? Madhab.Hanafi : Madhab.Shafi;
  // adhan reads the calendar day from the Date's own (local) fields.
  const times = new PrayerTimes(new Coordinates(settings.latitude, settings.longitude), new Date(year, month - 1, date), params);
  return { fajr: times.fajr, dhuhr: times.dhuhr, asr: times.asr, maghrib: times.maghrib, isha: times.isha };
}

const HIJRI = new Intl.DateTimeFormat('en-US-u-ca-islamic-umalqura-nu-latn', { timeZone: 'UTC', day: 'numeric', month: 'numeric', year: 'numeric' });

// The Hijri (Umm al-Qura) date of a "YYYY-MM-DD" day; adjust 1 reads day N
// as the calculated day N - 1 (the moon seen a day later).
export function hijriParts(day: string, adjust = 0): { year: number; month: number; day: number } {
  const date = new Date(new Date(`${day}T00:00:00.000Z`).getTime() - adjust * 24 * 60 * 60 * 1000);
  const parts = HIJRI.formatToParts(date);
  const num = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: num('year'), month: num('month'), day: num('day') };
}

// Whether a day is in Ramadan, by the person's Hijri adjustment.
export const isRamadan = (day: string, adjust = 0): boolean => hijriParts(day, adjust).month === 9;
