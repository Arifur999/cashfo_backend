import { describe, expect, it } from 'vitest';
import { cleanMarks, dayOfReading, finishedOn, isRealDay, pastDay, readingStart, storedMarks } from './library.js';

describe('cleanMarks', () => {
  it('keeps highlights inside the text, in order', () => {
    expect(
      cleanMarks(
        [
          { s: 6, e: 10, c: 'pink' },
          { s: 0, e: 5, c: 'yellow' },
        ],
        'Hello there',
      ),
    ).toEqual([
      { s: 0, e: 5, c: 'yellow' },
      { s: 6, e: 10, c: 'pink' },
    ]);
    expect(cleanMarks([], 'Hello')).toBeNull();
  });

  it('refuses highlights outside the text, overlapping or in another colour', () => {
    expect(() => cleanMarks([{ s: 0, e: 12, c: 'yellow' }], 'Hello there')).toThrow('A highlight must cover words of the note');
    expect(() => cleanMarks([{ s: 3, e: 3, c: 'yellow' }], 'Hello there')).toThrow('A highlight must cover words of the note');
    expect(() =>
      cleanMarks(
        [
          { s: 0, e: 5, c: 'yellow' },
          { s: 4, e: 8, c: 'green' },
        ],
        'Hello there',
      ),
    ).toThrow("Highlights can't overlap");
    expect(() => cleanMarks([{ s: 0, e: 5, c: 'blue' }], 'Hello there')).toThrow('Pick yellow, green or pink');
  });

  it('reads back only well-formed marks', () => {
    expect(storedMarks(null)).toEqual([]);
    expect(storedMarks([{ s: 0, e: 2, c: 'green' }, { s: 'x' }, null])).toEqual([{ s: 0, e: 2, c: 'green' }]);
  });
});

describe('days', () => {
  it('knows real calendar days', () => {
    expect(isRealDay('2028-02-29')).toBe(true);
    expect(isRealDay('2026-02-29')).toBe(false);
    expect(isRealDay('2026-13-01')).toBe(false);
  });

  it('takes a past day, never one to come', () => {
    expect(pastDay('2026-11-03', '2026-11-03')).toBe('2026-11-03');
    expect(() => pastDay('2026-11-04', '2026-11-03')).toThrow("The date can't be in the future");
    expect(() => pastDay('2026-02-30', '2026-11-03')).toThrow('Pick a real date');
  });

  it('dates a finish on the day it was logged', () => {
    const now = new Date('2026-11-03T08:00:00.000Z');
    expect(finishedOn('2026-11-03', '2026-11-03', now)).toBe(now);
    expect(finishedOn('2026-11-01', '2026-11-03', now)).toEqual(new Date('2026-11-01T06:00:00.000Z'));
  });
});

describe('a day of reading', () => {
  it('begins where it began, or for older rows where the book is now less the pages', () => {
    expect(dayOfReading({ pages: 20, fromPage: 122 }, 150)).toEqual({ from: 122, to: 142 });
    expect(dayOfReading({ pages: 20, fromPage: null }, 142)).toEqual({ from: 122, to: 142 });
  });

  it('starts a new day where the book is and corrects only the latest day', () => {
    const latest = { date: '2026-11-02', pages: 14, fromPage: 108 };
    expect(readingStart('2026-11-03', latest, 122, false)).toEqual({ from: 122, correcting: false });
    expect(readingStart('2026-11-02', latest, 122, false)).toEqual({ from: 108, correcting: true });
    expect(() => readingStart('2026-11-01', latest, 122, true)).toThrow('Only the latest day can be changed here');
    expect(readingStart('2026-11-01', null, 0, false)).toEqual({ from: 0, correcting: false });
  });
});
