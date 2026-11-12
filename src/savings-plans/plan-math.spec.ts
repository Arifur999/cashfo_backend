import { addMonths, planMonthly, planMonths, planNeedBy } from './plan-math.js';

// The Saving plans board's arithmetic: when a plan is needed by and what
// starting it today means a month.
describe('saving plan math', () => {
  it('keeps the day of the month, or the last day of a shorter month', () => {
    expect(addMonths('2026-10-31', 3)).toBe('2027-01-31');
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
  });

  it('counts a length of time from today, a date as it is, and some day as none', () => {
    expect(planNeedBy({ horizon: 'SIX_MONTHS', needBy: null }, '2026-10-31')).toBe('2027-04-30');
    expect(planNeedBy({ horizon: 'BY_DATE', needBy: '2029-05-31' }, '2026-10-31')).toBe('2029-05-31');
    expect(planNeedBy({ horizon: 'SOMEDAY', needBy: null }, '2026-10-31')).toBeNull();
  });

  it('rounds the monthly amount up to the next 10 taka, as the board does', () => {
    // New phone for Amma: 35,000 within 3 months = 11,670 a month.
    expect(planMonthly({ amount: 35000, horizon: 'THREE_MONTHS', needBy: null }, '2026-10-31')).toBe(11670);
    // Hajj: 7,50,000 by 31 May 2029 = about 31 months, 24,200 a month.
    expect(planMonths({ horizon: 'BY_DATE', needBy: '2029-05-31' }, '2026-10-31')).toBe(31);
    expect(planMonthly({ amount: 750000, horizon: 'BY_DATE', needBy: '2029-05-31' }, '2026-10-31')).toBe(24200);
    // Motorbike: 2,50,000 within a year = 20,840 a month.
    expect(planMonthly({ amount: 250000, horizon: 'ONE_YEAR', needBy: null }, '2026-10-31')).toBe(20840);
  });

  it('has no monthly amount without a date, and at least one month for a near date', () => {
    expect(planMonthly({ amount: 500000, horizon: 'SOMEDAY', needBy: null }, '2026-10-31')).toBe(0);
    expect(planMonths({ horizon: 'BY_DATE', needBy: '2026-11-02' }, '2026-10-31')).toBe(1);
  });
});
