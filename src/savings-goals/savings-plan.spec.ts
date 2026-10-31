import { describe, expect, it } from 'vitest';
import { daysBetween, planPace } from './savings-plan.js';

describe('daysBetween', () => {
  it('counts calendar days either way', () => {
    expect(daysBetween('2026-10-01', '2026-10-31')).toBe(30);
    expect(daysBetween('2026-10-31', '2026-10-01')).toBe(-30);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
  });
});

describe('planPace', () => {
  const base = { target: 150000, planStart: '2026-03-01', planStartAmount: 0, end: '2027-06-30', today: '2026-10-31' };

  it('reads a goal well over the line as Ahead', () => {
    // 244 of 486 days gone: the line says ৳75,309.
    const pace = planPace({ ...base, saved: 80000 });
    expect(pace.expected).toBe(75309);
    expect(pace.difference).toBe(4691);
    expect(pace.state).toBe('AHEAD');
  });

  it('allows 3% of the target under the line before Behind', () => {
    expect(planPace({ ...base, saved: 75309 - 4500 }).state).toBe('ON_TRACK');
    expect(planPace({ ...base, saved: 75309 - 4501 }).state).toBe('BEHIND');
  });

  it('never allows less than ৳1,000 of slack', () => {
    const small = { target: 10000, planStart: '2026-10-01', planStartAmount: 0, end: '2026-11-30', today: '2026-10-31' };
    // Half way: ৳5,000 expected.
    expect(planPace({ ...small, saved: 4100 }).state).toBe('ON_TRACK');
    expect(planPace({ ...small, saved: 3999 }).state).toBe('BEHIND');
  });

  it('starts the line from what was saved on the plan day', () => {
    const pace = planPace({ target: 100000, saved: 60000, planStart: '2026-10-31', planStartAmount: 60000, end: '2027-10-31', today: '2026-10-31' });
    expect(pace).toEqual({ expected: 60000, difference: 0, state: 'ON_TRACK' });
  });

  it('expects the whole target once the end date has passed', () => {
    expect(planPace({ ...base, today: '2027-08-01', saved: 140000 })).toMatchObject({ expected: 150000, state: 'BEHIND' });
  });

  it('expects the start amount before the plan begins', () => {
    expect(planPace({ ...base, planStart: '2026-11-15', planStartAmount: 2000, saved: 2000 }).expected).toBe(2000);
  });
});
