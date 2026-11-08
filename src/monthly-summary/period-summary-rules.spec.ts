import { defaultPrefs } from '../notification-prefs/notification-prefs.js';
import { summaryDueOn, summaryRange } from './period-summary-rules.js';

describe('the daily and weekly summary', () => {
  it('is due from the chosen time on the chosen day, once', () => {
    const weekly = defaultPrefs(); // Friday 21:00
    expect(summaryDueOn(weekly, new Date('2026-11-06T14:59:00.000Z'), null)).toBeNull();
    expect(summaryDueOn(weekly, new Date('2026-11-06T15:00:00.000Z'), null)).toBe('2026-11-06');
    expect(summaryDueOn(weekly, new Date('2026-11-06T16:00:00.000Z'), '2026-11-06')).toBeNull();
    expect(summaryDueOn(weekly, new Date('2026-11-07T15:00:00.000Z'), null)).toBeNull();
    const daily = { ...defaultPrefs(), summary: { mode: 'daily' as const, day: 'fri' as const, time: '08:00' } };
    expect(summaryDueOn(daily, new Date('2026-11-07T02:00:00.000Z'), '2026-11-06')).toBe('2026-11-07');
    expect(summaryDueOn({ ...daily, summary: { ...daily.summary, mode: 'off' } }, new Date('2026-11-07T02:00:00.000Z'), null)).toBeNull();
  });

  it('covers the day, or the week ending on it', () => {
    expect(summaryRange('weekly', '2026-11-06')).toEqual({ start: new Date('2026-10-31T00:00:00.000Z'), end: new Date('2026-11-07T00:00:00.000Z') });
    expect(summaryRange('daily', '2026-11-06')).toEqual({ start: new Date('2026-11-06T00:00:00.000Z'), end: new Date('2026-11-07T00:00:00.000Z') });
  });
});
