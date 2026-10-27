import { endingSoon, graceEndsAt, transitionAt, type SubscriptionClock } from './subscription-rules.js';

const NOW = new Date('2026-10-27T06:00:00.000Z');
const daysFromNow = (days: number) => new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000);
const clock = (over: Partial<SubscriptionClock> = {}): SubscriptionClock => ({
  status: 'ACTIVE',
  planIsPaid: true,
  trialEndsAt: null,
  currentPeriodEnd: daysFromNow(10),
  cancelAtPeriodEnd: false,
  ...over,
});

describe('transitionAt', () => {
  it('leaves a running period, the free plan and a paid plan with no end alone', () => {
    expect(transitionAt(clock(), NOW, 3)).toBeNull();
    expect(transitionAt(clock({ planIsPaid: false, currentPeriodEnd: null }), NOW, 3)).toBeNull();
    expect(transitionAt(clock({ currentPeriodEnd: null }), NOW, 3)).toBeNull();
  });

  it('moves an unpaid ended period to PAST_DUE for the grace days, then EXPIRED back to free', () => {
    expect(transitionAt(clock({ currentPeriodEnd: daysFromNow(-1) }), NOW, 3)).toEqual({ to: 'PAST_DUE' });
    expect(transitionAt(clock({ status: 'PAST_DUE', currentPeriodEnd: daysFromNow(-1) }), NOW, 3)).toBeNull();
    expect(transitionAt(clock({ status: 'PAST_DUE', currentPeriodEnd: daysFromNow(-3) }), NOW, 3)).toEqual({ to: 'EXPIRED', dropToFree: true });
    expect(transitionAt(clock({ currentPeriodEnd: daysFromNow(-4) }), NOW, 3)).toEqual({ to: 'EXPIRED', dropToFree: true });
  });

  it('expires at once with no grace days', () => {
    expect(transitionAt(clock({ currentPeriodEnd: daysFromNow(-0.01) }), NOW, 0)).toEqual({ to: 'EXPIRED', dropToFree: true });
  });

  it('cancels at the period end, with no grace, when the customer asked to stop', () => {
    expect(transitionAt(clock({ cancelAtPeriodEnd: true, currentPeriodEnd: daysFromNow(-0.01) }), NOW, 3)).toEqual({ to: 'CANCELLED', dropToFree: true });
  });

  it('ends a trial at its end without a payment', () => {
    expect(transitionAt(clock({ status: 'TRIALING', trialEndsAt: daysFromNow(1), currentPeriodEnd: null }), NOW, 3)).toBeNull();
    expect(transitionAt(clock({ status: 'TRIALING', trialEndsAt: daysFromNow(-0.01), currentPeriodEnd: null }), NOW, 3)).toEqual({
      to: 'EXPIRED',
      dropToFree: true,
    });
  });

  it('leaves an already ended subscription alone', () => {
    expect(transitionAt(clock({ status: 'EXPIRED', planIsPaid: false, currentPeriodEnd: null }), NOW, 3)).toBeNull();
  });
});

describe('graceEndsAt', () => {
  it('is the period end plus the grace days', () => {
    expect(graceEndsAt(NOW, 3)).toEqual(daysFromNow(3));
    expect(graceEndsAt(NOW, -2)).toEqual(NOW);
  });
});

describe('endingSoon', () => {
  it('warns within three days of a paid period or trial ending, not before or after', () => {
    expect(endingSoon(clock({ currentPeriodEnd: daysFromNow(2) }), NOW)).toEqual({ endsAt: daysFromNow(2), trial: false });
    expect(endingSoon(clock({ currentPeriodEnd: daysFromNow(4) }), NOW)).toBeNull();
    expect(endingSoon(clock({ currentPeriodEnd: daysFromNow(-1) }), NOW)).toBeNull();
    expect(endingSoon(clock({ status: 'TRIALING', trialEndsAt: daysFromNow(1), currentPeriodEnd: null }), NOW)).toEqual({
      endsAt: daysFromNow(1),
      trial: true,
    });
  });

  it('never warns about the free plan', () => {
    expect(endingSoon(clock({ planIsPaid: false, currentPeriodEnd: daysFromNow(1) }), NOW)).toBeNull();
  });
});
