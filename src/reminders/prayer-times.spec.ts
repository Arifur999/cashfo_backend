import { dhakaParts } from './fire-times.js';
import { DEFAULT_PRAYER_SETTINGS, hijriParts, isRamadan, prayerTimesFor } from './prayer-times.js';

const clocks = (times: Record<string, Date>) => Object.fromEntries(Object.entries(times).map(([name, at]) => [name, dhakaParts(at).clock]));

describe('prayerTimesFor', () => {
  it('works out the day the app shows (Dhaka, Karachi, Hanafi)', () => {
    expect(clocks({ ...prayerTimesFor(DEFAULT_PRAYER_SETTINGS, '2026-10-22') })).toEqual({
      fajr: '04:43',
      dhuhr: '11:44',
      asr: '15:50',
      maghrib: '17:27',
      isha: '18:42',
    });
  });

  it('follows the Asr school and falls back to Karachi for an unknown method', () => {
    const shafii = prayerTimesFor({ ...DEFAULT_PRAYER_SETTINGS, asrSchool: 'SHAFII' }, '2026-10-22');
    expect(dhakaParts(shafii.asr).clock < '15:50').toBe(true);
    const unknown = prayerTimesFor({ ...DEFAULT_PRAYER_SETTINGS, method: 'toString' }, '2026-10-22');
    expect(clocks({ ...unknown })).toEqual(clocks({ ...prayerTimesFor(DEFAULT_PRAYER_SETTINGS, '2026-10-22') }));
  });
});

describe('Ramadan', () => {
  it('reads the Umm al-Qura calendar, shifted by the Hijri adjustment', () => {
    expect(hijriParts('2026-02-18')).toEqual({ year: 1447, month: 9, day: 1 });
    expect(isRamadan('2026-02-17')).toBe(false);
    expect(isRamadan('2026-02-18')).toBe(true);
    expect(isRamadan('2026-03-19')).toBe(true);
    expect(isRamadan('2026-03-20')).toBe(false);
    // The moon seen a day later: Ramadan starts and ends a day later.
    expect(isRamadan('2026-02-18', 1)).toBe(false);
    expect(isRamadan('2026-03-20', 1)).toBe(true);
  });
});
