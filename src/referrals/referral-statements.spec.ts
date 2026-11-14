import { renderReferralStatementEmail } from '../mail/templates/referral-statement-email.js';
import { payoutPaidSmsText } from './referral-notices.js';
import { statementDue } from './referral-statements.js';

describe('statementDue', () => {
  it("is last month's statement on the first three Dhaka days of a month", () => {
    // 1 Dec 00:30 in Dhaka is still 30 Nov in UTC.
    const due = statementDue(new Date('2026-11-30T18:30:00.000Z'));
    expect(due?.month).toBe('2026-11');
    expect(due?.from.toISOString()).toBe('2026-10-31T18:00:00.000Z');
    expect(due?.until.toISOString()).toBe('2026-11-30T18:00:00.000Z');
    expect(statementDue(new Date('2026-12-03T17:59:00.000Z'))?.month).toBe('2026-11');
  });

  it('is nothing later in the month, and January covers December', () => {
    expect(statementDue(new Date('2026-12-03T18:00:00.000Z'))).toBeNull();
    expect(statementDue(new Date('2026-11-30T17:59:00.000Z'))).toBeNull();
    const jan = statementDue(new Date('2027-01-01T06:00:00.000Z'));
    expect(jan).toMatchObject({ month: '2026-12', year: 2026, monthIndex: 11 });
  });
});

describe('referral statement and payout texts', () => {
  it('names the month, the payments and the share in both languages', () => {
    const email = { name: 'Nusrat', month: 'November 2026', payments: 2, earned: '687.60', available: '343.80', link: 'https://x/referrals/earnings' };
    const en = renderReferralStatementEmail('en', email, 'Smartly');
    expect(en.subject).toBe('Your referral statement for November 2026');
    expect(en.text).toContain('your friends made 2 payments, and your share was Tk 687.60');
    expect(en.text).toContain('Ready to withdraw now: Tk 343.80');
    expect(renderReferralStatementEmail('en', { ...email, payments: 1 }, 'Smartly').text).toContain('made 1 payment,');
    expect(renderReferralStatementEmail('bn', { ...email, month: 'নভেম্বর 2026' }, 'Smartly').subject).toContain('নভেম্বর 2026');
  });

  it('puts the amount, the account and the TrxID in the SMS', () => {
    expect(payoutPaidSmsText('en', '343.80', 'bKash 017•••915', '9I7KX2M4QD')).toBe('Smartly: Tk 343.80 sent to your bKash 017•••915. TrxID 9I7KX2M4QD.');
    expect(payoutPaidSmsText('bn', '৩৪৩.৮০', 'bKash 017•••915', '9I7KX2M4QD')).toContain('TrxID 9I7KX2M4QD');
  });
});
