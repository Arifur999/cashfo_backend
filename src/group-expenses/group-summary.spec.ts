import { collectedOf, currentGroupMonth, groupMonthPeriod, monthKeyText, owing, parseMonthKey } from './group-summary.js';

const day = (date: Date) => date.toISOString().slice(0, 10);

describe('group month', () => {
  it('runs from the start day to the day before the next one', () => {
    const plain = groupMonthPeriod({ year: 2026, month: 9 }, 1);
    expect([day(plain.periodStart), day(plain.periodEnd)]).toEqual(['2026-09-01', '2026-09-30']);
    const shifted = groupMonthPeriod({ year: 2026, month: 12 }, 5);
    expect([day(shifted.periodStart), day(shifted.periodEnd)]).toEqual(['2026-12-05', '2027-01-04']);
  });

  it('is still last month before the start day', () => {
    expect(currentGroupMonth({ year: 2026, month: 10, day: 28 }, 1)).toEqual({ year: 2026, month: 10 });
    expect(currentGroupMonth({ year: 2026, month: 10, day: 3 }, 5)).toEqual({ year: 2026, month: 9 });
    expect(currentGroupMonth({ year: 2026, month: 1, day: 3 }, 5)).toEqual({ year: 2025, month: 12 });
  });

  it('reads and writes YYYY-MM', () => {
    expect(parseMonthKey('2026-09')).toEqual({ year: 2026, month: 9 });
    expect(monthKeyText({ year: 2026, month: 9 })).toBe('2026-09');
  });
});

describe('card figures', () => {
  const members = [
    { name: 'Khaled', contributed: '30000.00', balance: '1200.00' },
    { name: 'Arif', contributed: '18000.00', balance: '-700.50' },
    { name: 'Rakib', contributed: '18000.00', balance: '-499.50' },
  ];

  it('adds up who has to pay', () => {
    expect(owing(members)).toEqual({ count: 2, total: '1200.00', names: ['Arif', 'Rakib'] });
    expect(owing([])).toEqual({ count: 0, total: '0.00', names: [] });
  });

  it('adds up the money in', () => {
    expect(collectedOf(members)).toBe('66000.00');
  });
});
