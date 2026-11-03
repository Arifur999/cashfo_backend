import { describe, expect, it } from 'vitest';
import { renderSavingsReminderEmail } from '../mail/templates/savings-reminder-email.js';
import { dateReminderDue, monthlyReminderMonth, perMonthFromNow } from './savings-reminders.js';

describe('dateReminderDue', () => {
  it('is due on its day and for two days after, once', () => {
    expect(dateReminderDue('2026-11-10', null, '2026-11-09')).toBe(false);
    expect(dateReminderDue('2026-11-10', null, '2026-11-10')).toBe(true);
    expect(dateReminderDue('2026-11-10', null, '2026-11-12')).toBe(true);
    expect(dateReminderDue('2026-11-10', null, '2026-11-13')).toBe(false);
    expect(dateReminderDue('2026-11-10', '2026-11-10', '2026-11-10')).toBe(false);
    expect(dateReminderDue(null, null, '2026-11-10')).toBe(false);
  });

  it('sends a new day after an earlier one went out', () => {
    expect(dateReminderDue('2026-12-01', '2026-11-10', '2026-12-01')).toBe(true);
  });
});

describe('monthlyReminderMonth', () => {
  it('names the month in its first three days, unless already sent', () => {
    expect(monthlyReminderMonth('2026-11-01', null)).toBe('2026-11');
    expect(monthlyReminderMonth('2026-11-03', '2026-10')).toBe('2026-11');
    expect(monthlyReminderMonth('2026-11-04', null)).toBeNull();
    expect(monthlyReminderMonth('2026-11-02', '2026-11')).toBeNull();
  });
});

describe('perMonthFromNow', () => {
  it('spreads what is left over the months to the end date', () => {
    expect(perMonthFromNow(150000, 80000, '2027-06-30', '2026-10-31')).toBe(8750);
    expect(perMonthFromNow(1000, 0, '2026-11-05', '2026-10-31')).toBe(1000);
    expect(perMonthFromNow(1000, 1200, '2027-06-30', '2026-10-31')).toBe(0);
  });
});

describe('renderSavingsReminderEmail', () => {
  const email = { name: 'Khaled', goalName: 'Umrah <trip>', kind: 'DATE' as const, saved: '25,000', target: '3,00,000', perMonth: '10,000', endDate: '31 Dec 2028', link: 'https://app/savings-goals/dashboard' };
  it('writes the day reminder in English, escaping the goal name', () => {
    const out = renderSavingsReminderEmail('en', email, 'Smartly');
    expect(out.subject).toBe('Reminder: Umrah <trip>');
    expect(out.html).toContain('Umrah &lt;trip&gt;');
    expect(out.text).toContain('Save each month: TK 10,000');
  });
  it('writes the monthly one in Bangla and leaves out the monthly line when there is none', () => {
    const out = renderSavingsReminderEmail('bn', { ...email, kind: 'MONTHLY', perMonth: null }, 'Smartly');
    expect(out.text).toContain('নতুন মাস শুরু হয়েছে');
    expect(out.text).not.toContain('প্রতি মাসে জমান');
  });
});
