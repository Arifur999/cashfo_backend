import { CalculationMethod, Coordinates, Madhab, PrayerTimes } from 'adhan';
import { dhakaParts } from '../reminders/fire-times.js';
import { hijriParts, isRamadan, prayerTimesFor, type PrayerSettingsInput } from '../reminders/prayer-times.js';

// GET /api/namaz/today: one day's prayer times, worked out by the same
// helper the reminders use (reminders/prayer-times.ts), so the page, the
// bell and a push all say the same time. Clock times are Dhaka 24-hour
// "HH:MM", like the rest of the customer app.

export interface NamazDayTimes {
  fajr: string;
  sunrise: string;
  dhuhr: string;
  asr: string;
  maghrib: string;
  isha: string;
}

export interface NamazDay {
  times: NamazDayTimes;
  // Sehri ends at Fajr and Iftar is at Maghrib (as the Ramadan reminders count them).
  sehri: string;
  iftar: string;
  hijri: { year: number; month: number; day: number };
  ramadan: boolean;
}

// Sunrise (when Fajr's time ends) isn't one of the reminders' five, so it
// comes from adhan here, with the same method and Asr school rules.
function sunriseFor(settings: PrayerSettingsInput, day: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  const method = Object.hasOwn(CalculationMethod, settings.method)
    ? CalculationMethod[settings.method as keyof typeof CalculationMethod]
    : CalculationMethod.Karachi;
  const params = method();
  params.madhab = settings.asrSchool === 'HANAFI' ? Madhab.Hanafi : Madhab.Shafi;
  return new PrayerTimes(new Coordinates(settings.latitude, settings.longitude), new Date(year, month - 1, date), params).sunrise;
}

export function namazDay(settings: PrayerSettingsInput, day: string): NamazDay {
  const five = prayerTimesFor(settings, day);
  const clock = (at: Date) => dhakaParts(at).clock;
  const times: NamazDayTimes = {
    fajr: clock(five.fajr),
    sunrise: clock(sunriseFor(settings, day)),
    dhuhr: clock(five.dhuhr),
    asr: clock(five.asr),
    maghrib: clock(five.maghrib),
    isha: clock(five.isha),
  };
  return { times, sehri: times.fajr, iftar: times.maghrib, hijri: hijriParts(day, settings.hijriAdjust), ramadan: isRamadan(day, settings.hijriAdjust) };
}
