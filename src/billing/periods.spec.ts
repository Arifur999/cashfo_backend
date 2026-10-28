import { addCycle, addMonths, isPaidStatus, paidPeriod, purposeFor, type SubscriptionSnapshot } from './periods.js';

const d = (iso: string) => new Date(iso);
const sub = (over: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot => ({
  planId: 'monthly',
  status: 'ACTIVE',
  currentPeriodEnd: d('2026-11-10T06:00:00.000Z'),
  planIsPaid: true,
  ...over,
});

describe('addMonths / addCycle', () => {
  it('keeps the day and time of day', () => {
    expect(addMonths(d('2026-10-27T06:30:00.000Z'), 1)).toEqual(d('2026-11-27T06:30:00.000Z'));
  });

  it('lands on the last day of a shorter month, never in the one after', () => {
    expect(addMonths(d('2026-01-31T10:00:00.000Z'), 1)).toEqual(d('2026-02-28T10:00:00.000Z'));
    expect(addMonths(d('2028-01-31T10:00:00.000Z'), 1)).toEqual(d('2028-02-29T10:00:00.000Z'));
    expect(addMonths(d('2026-12-15T00:00:00.000Z'), 1)).toEqual(d('2027-01-15T00:00:00.000Z'));
  });

  it('is a month, a year, or nothing for a free plan', () => {
    const from = d('2026-10-27T06:00:00.000Z');
    expect(addCycle(from, 'MONTHLY')).toEqual(d('2026-11-27T06:00:00.000Z'));
    expect(addCycle(d('2028-02-29T06:00:00.000Z'), 'YEARLY')).toEqual(d('2029-02-28T06:00:00.000Z'));
    expect(addCycle(from, 'FREE')).toBeNull();
  });
});

describe('isPaidStatus', () => {
  it('counts an active or past-due paid plan, never a trial or the free plan', () => {
    expect(isPaidStatus('ACTIVE', true)).toBe(true);
    expect(isPaidStatus('PAST_DUE', true)).toBe(true);
    expect(isPaidStatus('TRIALING', true)).toBe(false);
    expect(isPaidStatus('ACTIVE', false)).toBe(false);
  });
});

describe('purposeFor', () => {
  it('is NEW from the free plan or a trial, RENEWAL for the same paid plan, UPGRADE for another', () => {
    expect(purposeFor(null, 'monthly')).toBe('NEW');
    expect(purposeFor(sub({ planIsPaid: false, planId: 'free' }), 'monthly')).toBe('NEW');
    expect(purposeFor(sub({ status: 'TRIALING' }), 'monthly')).toBe('NEW');
    expect(purposeFor(sub(), 'monthly')).toBe('RENEWAL');
    expect(purposeFor(sub({ status: 'PAST_DUE' }), 'monthly')).toBe('RENEWAL');
    expect(purposeFor(sub(), 'yearly')).toBe('UPGRADE');
  });
});

describe('paidPeriod', () => {
  const paidAt = d('2026-10-27T06:00:00.000Z');

  it('starts at the payment for a first purchase', () => {
    expect(paidPeriod(null, 'monthly', 'MONTHLY', paidAt)).toEqual({ start: paidAt, end: d('2026-11-27T06:00:00.000Z') });
  });

  it('adds a renewal paid early to the end of the running period', () => {
    expect(paidPeriod(sub(), 'monthly', 'MONTHLY', paidAt)).toEqual({ start: d('2026-11-10T06:00:00.000Z'), end: d('2026-12-10T06:00:00.000Z') });
  });

  it('starts a late renewal (in the grace days) at the payment', () => {
    const late = sub({ status: 'PAST_DUE', currentPeriodEnd: d('2026-10-25T06:00:00.000Z') });
    expect(paidPeriod(late, 'monthly', 'MONTHLY', paidAt).start).toEqual(paidAt);
  });

  it('starts a change of plan at the payment', () => {
    expect(paidPeriod(sub(), 'yearly', 'YEARLY', paidAt)).toEqual({ start: paidAt, end: d('2027-10-27T06:00:00.000Z') });
  });

  it('starts at the payment for a paid plan an admin set with no end', () => {
    expect(paidPeriod(sub({ currentPeriodEnd: null }), 'monthly', 'MONTHLY', paidAt).start).toEqual(paidAt);
  });
});
