import { DEFAULT_PRAYER_SETTINGS } from '../reminders/prayer-times.js';
import { namazDay } from './namaz-today.js';

describe('namazDay', () => {
  it('gives the times the reminders use, with sunrise between Fajr and Dhuhr', () => {
    const day = namazDay(DEFAULT_PRAYER_SETTINGS, '2026-10-22');
    expect(day.times).toMatchObject({ fajr: '04:43', dhuhr: '11:44', asr: '15:50', maghrib: '17:27', isha: '18:42' });
    expect(day.times.sunrise > day.times.fajr && day.times.sunrise < day.times.dhuhr).toBe(true);
    expect(day.sehri).toBe('04:43');
    expect(day.iftar).toBe('17:27');
    expect(day.ramadan).toBe(false);
  });

  it('reads the Hijri date with the adjustment', () => {
    expect(namazDay(DEFAULT_PRAYER_SETTINGS, '2026-02-18')).toMatchObject({ hijri: { year: 1447, month: 9, day: 1 }, ramadan: true });
    expect(namazDay({ ...DEFAULT_PRAYER_SETTINGS, hijriAdjust: 1 }, '2026-02-18').ramadan).toBe(false);
  });
});
