import { foldIntoMonths, monthBucketsBetween } from './month-buckets.js';

describe('monthBucketsBetween', () => {
  it('clips the first and last month to the range', () => {
    const buckets = monthBucketsBetween('2026-07-15', '2026-09-10');
    expect(buckets.map((b) => b.key)).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(buckets[0].start.toISOString()).toBe('2026-07-15T00:00:00.000Z');
    expect(buckets[0].end.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(buckets[1].start.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    // The last day is included: the bucket ends the moment the next day starts.
    expect(buckets[2].end.toISOString()).toBe('2026-09-11T00:00:00.000Z');
  });

  it('handles a single day and a year boundary', () => {
    const day = monthBucketsBetween('2026-10-05', '2026-10-05');
    expect(day).toHaveLength(1);
    expect(day[0].end.getTime() - day[0].start.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(monthBucketsBetween('2025-12-20', '2026-01-03').map((b) => b.key)).toEqual(['2025-12', '2026-01']);
  });

  it('is empty for a backwards range or one longer than two years', () => {
    expect(monthBucketsBetween('2026-10-05', '2026-10-04')).toEqual([]);
    expect(monthBucketsBetween('2024-01-01', '2026-02-01')).toEqual([]);
    expect(monthBucketsBetween('2024-03-01', '2026-02-28')).toHaveLength(24);
  });
});

describe('foldIntoMonths', () => {
  const day = (iso: string, count: number) => ({ date: new Date(`${iso}T00:00:00.000Z`), count });

  it('adds up the days of each month, newest month first', () => {
    expect(foldIntoMonths([day('2026-09-30', 2), day('2026-10-01', 1), day('2025-12-31', 4), day('2026-10-28', 3)])).toEqual([
      { year: 2026, month: 10, count: 4 },
      { year: 2026, month: 9, count: 2 },
      { year: 2025, month: 12, count: 4 },
    ]);
  });

  it('answers nothing for no days', () => {
    expect(foldIntoMonths([])).toEqual([]);
  });
});
