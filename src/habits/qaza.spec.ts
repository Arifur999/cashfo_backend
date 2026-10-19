import { describe, expect, it } from 'vitest';
import { missedSince } from './qaza.js';

const day = (key: string) => new Date(`${key}T00:00:00.000Z`);

describe('missedSince', () => {
  const sheet = {
    month: 10,
    year: 2026,
    checks: [
      { day: 1, item: 'Fajr', status: 'JAMAAT' as const },
      { day: 1, item: 'Dhuhr', status: 'QAZA' as const },
      { day: 1, item: 'Asr', status: 'MISSED' as const },
      { day: 2, item: 'Isha', status: 'MISSED' as const },
    ],
  };

  it('counts unmarked past prayers and explicit misses, not today\'s open ones', () => {
    // 1 Oct: Asr marked missed, Maghrib and Isha unmarked. 2 Oct is today:
    // only Isha, marked missed, counts.
    expect(missedSince([sheet], day('2026-10-01'), day('2026-10-02'))).toEqual({ Fajr: 0, Dhuhr: 0, Asr: 1, Maghrib: 1, Isha: 2 });
  });

  it('starts at the counting day and skips months with no sheet', () => {
    expect(missedSince([sheet], day('2026-10-02'), day('2026-10-02'))).toEqual({ Fajr: 0, Dhuhr: 0, Asr: 0, Maghrib: 0, Isha: 1 });
    expect(missedSince([{ month: null, year: null, checks: [] }], day('2026-01-01'), day('2026-10-02'))).toEqual({ Fajr: 0, Dhuhr: 0, Asr: 0, Maghrib: 0, Isha: 0 });
  });
});
