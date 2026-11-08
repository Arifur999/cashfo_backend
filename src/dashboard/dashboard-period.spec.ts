import { addMonths, countsPer, daysIn, lastDayOf, monthsIn, previousSpan, resolveDashboardRange, revenueMonths } from './dashboard-period.js';

const TODAY = '2026-10-28';

describe('resolveDashboardRange', () => {
  it('reads a whole month as a month, cut off at today while it runs', () => {
    expect(resolveDashboardRange('2026-10-01', '2026-10-31', TODAY)).toEqual({ from: '2026-10-01', to: '2026-10-28', kind: 'month', unit: 'day', isNow: true });
    expect(resolveDashboardRange('2026-02-01', '2026-02-28', TODAY)).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
      kind: 'month',
      unit: 'day',
      isNow: false,
    });
  });

  it('draws a year by month, and other days by day up to 62 of them', () => {
    expect(resolveDashboardRange('2025-01-01', '2025-12-31', TODAY)).toMatchObject({ kind: 'year', unit: 'month', isNow: false });
    expect(resolveDashboardRange('2026-01-01', '2026-12-31', TODAY)).toMatchObject({ kind: 'year', unit: 'month', to: TODAY, isNow: true });
    expect(resolveDashboardRange('2026-08-28', '2026-10-28', TODAY)).toMatchObject({ kind: 'custom', unit: 'day' });
    expect(resolveDashboardRange('2026-08-27', '2026-10-28', TODAY)).toMatchObject({ kind: 'custom', unit: 'month' });
  });

  it('shrinks a period that starts after today to today', () => {
    expect(resolveDashboardRange('2026-12-01', '2026-12-31', TODAY)).toMatchObject({ from: TODAY, to: TODAY, kind: 'month', isNow: true });
  });
});

describe('calendar helpers', () => {
  it('counts months and days across a year end and a leap day', () => {
    expect(addMonths('2026-11', 3)).toBe('2027-02');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(lastDayOf('2028-02')).toBe('2028-02-29');
    expect(monthsIn('2025-11-15', '2026-02-01')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(daysIn('2026-10-01', '2026-10-28')).toBe(28);
  });
});

describe('revenueMonths', () => {
  it('shows the six months to a chosen month, that month dark', () => {
    expect(revenueMonths(resolveDashboardRange('2026-10-01', '2026-10-31', TODAY))).toEqual({
      months: ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'],
      highlight: ['2026-10'],
    });
  });

  it('shows a year month by month, and widens a short span to six months', () => {
    expect(revenueMonths(resolveDashboardRange('2025-01-01', '2025-12-31', TODAY)).months).toHaveLength(12);
    expect(revenueMonths(resolveDashboardRange('2026-09-10', '2026-10-05', TODAY))).toEqual({
      months: ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'],
      highlight: ['2026-09', '2026-10'],
    });
  });

  it('keeps the last twelve months of a longer span', () => {
    const { months, highlight } = revenueMonths(resolveDashboardRange('2025-01-01', '2026-10-28', TODAY));
    expect(months[0]).toBe('2025-11');
    expect(months).toHaveLength(12);
    expect(highlight).toHaveLength(22);
  });
});

describe('previousSpan', () => {
  it('compares a month with the whole month before', () => {
    expect(previousSpan(resolveDashboardRange('2026-10-01', '2026-10-31', TODAY))).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(previousSpan(resolveDashboardRange('2026-01-01', '2026-01-31', TODAY))).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('compares a year with the same days a year before, and other days with as many before', () => {
    expect(previousSpan(resolveDashboardRange('2026-01-01', '2026-12-31', TODAY))).toEqual({ from: '2025-01-01', to: '2025-10-28' });
    expect(previousSpan(resolveDashboardRange('2026-10-11', '2026-10-20', TODAY))).toEqual({ from: '2026-10-01', to: '2026-10-10' });
  });
});

describe('countsPer', () => {
  it('counts sign-ups per Dhaka day, with the empty days', () => {
    const rows = countsPer(
      [
        new Date('2026-10-01T18:30:00.000Z'), // 2 Oct 00:30 in Dhaka
        new Date('2026-10-01T17:00:00.000Z'), // 1 Oct 23:00 in Dhaka
      ],
      { from: '2026-10-01', to: '2026-10-03', unit: 'day' },
    );
    expect(rows).toEqual([
      { key: '2026-10-01', count: 1 },
      { key: '2026-10-02', count: 1 },
      { key: '2026-10-03', count: 0 },
    ]);
  });

  it('counts per month for a long span', () => {
    expect(countsPer([new Date('2026-09-30T19:00:00.000Z')], { from: '2026-09-01', to: '2026-10-28', unit: 'month' })).toEqual([
      { key: '2026-09', count: 0 },
      { key: '2026-10', count: 1 },
    ]);
  });
});
