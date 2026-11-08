import { alertOfRow, allows, countOn, defaultPrefs, inQuietHours, resolvePrefs } from './notification-prefs.js';

describe('notification prefs', () => {
  it('reads what is stored over the defaults, dropping what it does not know and keeping security on', () => {
    const prefs = resolvePrefs({ alerts: { budget: { push: false }, device: { app: false, email: false }, made: { app: true } }, loanDaysBefore: 7, eventDaysBefore: 5, quiet: { from: '23:00', to: 'x' }, summary: { mode: 'daily', day: 'mon' } });
    expect(prefs.alerts.budget).toEqual({ app: true, email: true, sms: false, push: false });
    expect(prefs.alerts.device).toMatchObject({ app: true, email: true });
    expect(prefs.alerts).not.toHaveProperty('made');
    expect(prefs).toMatchObject({ loanDaysBefore: 7, eventDaysBefore: 1, quiet: { on: true, from: '23:00', to: '07:00' }, summary: { mode: 'daily', day: 'mon', time: '21:00' } });
    expect(resolvePrefs(null)).toEqual(defaultPrefs());
  });

  it('holds SMS and push in quiet hours past midnight, never the bell or security, and SMS only on Pro', () => {
    const prefs = defaultPrefs();
    expect(inQuietHours(prefs, '23:30')).toBe(true);
    expect(inQuietHours(prefs, '06:59')).toBe(true);
    expect(inQuietHours(prefs, '07:00')).toBe(false);
    expect(allows(prefs, 'budget', 'push', { pro: true, dhakaClock: '23:30' })).toBe(false);
    expect(allows(prefs, 'budget', 'app', { pro: true, dhakaClock: '23:30' })).toBe(true);
    expect(allows(prefs, 'device', 'push', { pro: true, dhakaClock: '23:30' })).toBe(true);
    expect(allows(prefs, 'loanDue', 'sms', { pro: false, dhakaClock: '12:00' })).toBe(false);
    expect(allows(prefs, 'loanDue', 'sms', { pro: true, dhakaClock: '12:00' })).toBe(true);
  });

  it('finds the switch a bell row belongs to, and counts what is on', () => {
    expect(alertOfRow('LOAN_DUE', { direction: 'PAYABLE' })).toBe('loanDue');
    expect(alertOfRow('LOAN_DUE', { direction: 'RECEIVABLE' })).toBe('collect');
    expect(alertOfRow('REFERRAL', { event: 'COMMISSION_AVAILABLE' })).toBe('refEarn');
    expect(alertOfRow('REFERRAL', { event: 'PAYOUT_PAID' })).toBeNull();
    expect(alertOfRow('ANNOUNCEMENT', null)).toBeNull();
    expect(countOn(defaultPrefs())).toEqual({ on: 37, total: 68 });
  });
});
