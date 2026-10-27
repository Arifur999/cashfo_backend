import { renderAdminInviteEmail } from './admin-invite-email.js';
import { renderAdminPasswordResetEmail } from './admin-password-reset-email.js';
import { renderBillingReceiptEmail } from './billing-receipt-email.js';
import { renderOneTimeCodeEmail } from './one-time-code-email.js';
import { renderPasswordResetEmail } from './password-reset-email.js';
import { renderPayoutNoticeEmail, type PayoutNotice } from './payout-notice-email.js';
import { renderPlanNoticeEmail } from './plan-notice-email.js';
import { renderSupportReplyEmail } from './support-reply-email.js';
import { renderTwoStepNoticeEmail } from './two-step-notice-email.js';
import { renderWelcomeEmail } from './welcome-email.js';

const OLD_NAME = 'Money Management Tracker';

const PAYOUT_PAID: PayoutNotice = {
  kind: 'PAID',
  name: 'Nasrin',
  displayId: 'WD-1047',
  amount: '2,160',
  destination: 'Nagad 01819-•••310',
  trxId: '8K2M4N7QXA',
  reason: null,
  incomeWallet: 'Cash',
  link: 'https://app.example/referrals?tab=withdrawals',
};

const templates = {
  welcome: (platformName: string) => renderWelcomeEmail('Nadia', platformName),
  'password reset': (platformName: string) => renderPasswordResetEmail('Nadia', 'https://app.example/reset-password?token=abc', platformName),
  'support reply': (platformName: string) => renderSupportReplyEmail('Nadia', 'Export failed', 'Fixed now.', 'https://app.example/settings/help?message=t1', platformName),
  'billing receipt': (platformName: string) =>
    renderBillingReceiptEmail('en', { name: 'Nadia', planName: 'Monthly Pro', amount: '299', invoiceNumber: 'INV-2026-000042', paidUntil: '27 Nov 2026', link: 'https://x' }, platformName),
  'billing receipt (Bangla)': (platformName: string) =>
    renderBillingReceiptEmail('bn', { name: 'Nadia', planName: 'Monthly Pro', amount: '২৯৯', invoiceNumber: 'INV-2026-000042', paidUntil: null, link: 'https://x' }, platformName),
  'plan ending': (platformName: string) =>
    renderPlanNoticeEmail('en', { kind: 'ENDING', name: 'Nadia', planName: 'Monthly Pro', trial: false, date: '30 Oct 2026', link: 'https://x' }, platformName),
  'trial ended (Bangla)': (platformName: string) =>
    renderPlanNoticeEmail('bn', { kind: 'ENDED', name: 'Nadia', planName: 'Monthly Pro', trial: true, date: '৩০ অক্টোবর ২০২৬', link: 'https://x' }, platformName),
  'one-time code': (platformName: string) =>
    renderOneTimeCodeEmail('en', { name: 'Nadia', code: '481527', action: 'withdraw ৳ 1,000 to bKash 01711-•••915', minutes: 10 }, platformName),
  'one-time code (Bangla)': (platformName: string) =>
    renderOneTimeCodeEmail('bn', { name: 'Nadia', code: '481527', action: 'বিকাশ 01711-•••915-এ ৳ ১,০০০ তোলা', minutes: 10 }, platformName),
  'payout paid': (platformName: string) => renderPayoutNoticeEmail('en', PAYOUT_PAID, platformName),
  'two-step on': (platformName: string) => renderTwoStepNoticeEmail('en', { kind: 'ON', name: 'Nadia', link: 'https://x/settings/security' }, platformName),
  'two-step off by support (Bangla)': (platformName: string) =>
    renderTwoStepNoticeEmail('bn', { kind: 'OFF_BY_SUPPORT', name: 'Nadia', link: 'https://x/settings/security' }, platformName),
  'admin invite': (platformName: string) =>
    renderAdminInviteEmail(
      { name: null, inviterName: 'Nadia Rahman', role: { en: 'Finance admin', bn: 'ফাইন্যান্স অ্যাডমিন' }, link: 'https://x/admin/invite?token=t', expires: { en: '3 Nov 2026', bn: '৩ নভেম্বর ২০২৬' } },
      platformName,
    ),
  'admin password reset (Bangla)': (platformName: string) =>
    renderAdminPasswordResetEmail('bn', { name: 'Imran', link: 'https://x/admin/reset-password?token=t', minutes: 30 }, platformName),
  'payout rejected (Bangla)': (platformName: string) =>
    renderPayoutNoticeEmail('bn', { ...PAYOUT_PAID, kind: 'REJECTED', trxId: null, incomeWallet: null, reason: 'নাম মেলেনি' }, platformName),
};

describe.each(Object.entries(templates))('the %s email', (_label, render) => {
  it('signs off with the given platform name and never the old one', () => {
    const email = render('Smartly');
    expect(email.text).toContain('- Smartly');
    expect(email.html).toContain('Smartly');
    for (const part of [email.subject, email.text, email.html]) {
      expect(part).not.toContain(OLD_NAME);
    }
  });

  it('uses whatever name it is given', () => {
    const email = render('Acme Books');
    expect(email.text).toContain('Acme Books');
    expect(email.html).toContain('Acme Books');
    expect(`${email.subject}${email.text}${email.html}`).not.toContain('Smartly');
  });

  it('escapes the name in the HTML', () => {
    const email = render('<b>Acme</b>');
    expect(email.html).toContain('&lt;b&gt;Acme&lt;/b&gt;');
    expect(email.html).not.toContain('<b>Acme</b>');
  });
});

describe('billing emails', () => {
  it('give the receipt its invoice number and the date the plan runs to', () => {
    const email = renderBillingReceiptEmail('en', { name: 'Nadia', planName: 'Monthly Pro', amount: '299', invoiceNumber: 'INV-2026-000042', paidUntil: '27 Nov 2026', link: 'https://x' }, 'Smartly');
    expect(email.subject).toBe('Payment received: INV-2026-000042');
    expect(email.text).toContain('Your plan runs until 27 Nov 2026.');
  });

  it('say in Bangla when the plan ends', () => {
    const email = renderPlanNoticeEmail('bn', { kind: 'ENDING', name: 'নাদিয়া', planName: 'Monthly Pro', trial: false, date: '৩০ অক্টোবর ২০২৬', link: 'https://x' }, 'Smartly');
    expect(email.subject).toBe('আপনার Monthly Pro প্ল্যান ৩০ অক্টোবর ২০২৬ তারিখে শেষ হবে');
  });

  it('escape the plan name', () => {
    const email = renderPlanNoticeEmail('en', { kind: 'ENDED', name: 'N', planName: '<i>Pro</i>', trial: false, date: '1 Nov 2026', link: 'https://x' }, 'Smartly');
    expect(email.html).not.toContain('<i>Pro</i>');
  });
});

describe('referral emails', () => {
  it('put the code in the subject and the body, and say how long it lasts', () => {
    const email = renderOneTimeCodeEmail('en', { name: 'Khaled', code: '004815', action: 'withdraw ৳ 1,000 to bKash', minutes: 10 }, 'Smartly');
    expect(email.subject).toBe('Your code: 004815');
    expect(email.text).toContain('Enter this code to withdraw ৳ 1,000 to bKash:');
    expect(email.text).toContain('for 10 minutes');
  });

  it('give a paid payout its transaction id and the wallet the income went to', () => {
    const email = renderPayoutNoticeEmail('en', PAYOUT_PAID, 'Smartly');
    expect(email.subject).toBe('Your withdrawal WD-1047 is paid');
    expect(email.text).toContain('We sent ৳ 2,160 to Nagad 01819-•••310.');
    expect(email.text).toContain('Transaction ID: 8K2M4N7QXA');
    expect(email.text).toContain('Cash wallet');
  });

  it('tell a rejected request the reason and that the money is back', () => {
    const email = renderPayoutNoticeEmail('en', { ...PAYOUT_PAID, kind: 'REJECTED', trxId: null, incomeWallet: null, reason: '<b>Name</b> did not match' }, 'Smartly');
    expect(email.text).toContain('Reason: <b>Name</b> did not match');
    expect(email.text).toContain('back in your referral balance');
    expect(email.html).not.toContain('<b>Name</b>');
  });
});

describe('subjects', () => {
  it('welcomes the user to the platform by name', () => {
    expect(renderWelcomeEmail('Nadia', 'Smartly').subject).toBe('Welcome to Smartly');
  });

  it('keeps the password reset and support reply subjects as they were', () => {
    expect(renderPasswordResetEmail('Nadia', 'https://x', 'Smartly').subject).toBe('Reset your password');
    expect(renderSupportReplyEmail('Nadia', 'Export failed', 'ok', 'https://x', 'Smartly').subject).toBe('Re: Export failed');
  });

  it('signs a support reply from the platform support team', () => {
    const email = renderSupportReplyEmail('Nadia', 'Export failed', 'ok', 'https://x', 'Smartly');
    expect(email.text.endsWith('- Smartly support')).toBe(true);
    expect(email.html).toContain('Smartly support</p>');
  });
});

describe('security emails', () => {
  it('invite in English and Bangla, with the link and the end date', () => {
    const email = renderAdminInviteEmail(
      { name: 'Rumana', inviterName: '<b>Nadia</b>', role: { en: 'Finance admin', bn: 'ফাইন্যান্স অ্যাডমিন' }, link: 'https://x/admin/invite?token=t', expires: { en: '3 Nov 2026', bn: '৩ নভেম্বর ২০২৬' } },
      'Smartly',
    );
    expect(email.text).toContain('as Finance admin');
    expect(email.text).toContain('ফাইন্যান্স অ্যাডমিন হিসেবে');
    expect(email.text).toContain('ends on 3 Nov 2026');
    expect(email.text).toContain('https://x/admin/invite?token=t');
    expect(email.html).not.toContain('<b>Nadia</b>');
  });

  it('give the admin reset link its 30 minutes and say two-step stays on', () => {
    const email = renderAdminPasswordResetEmail('en', { name: 'Imran', link: 'https://x/admin/reset-password?token=t', minutes: 30 }, 'Smartly');
    expect(email.subject).toBe('Reset your Smartly admin password');
    expect(email.text).toContain('for 30 minutes');
    expect(email.text).toContain('Two-step sign-in stays on.');
  });

  it('warn the customer when two-step changed without them', () => {
    expect(renderTwoStepNoticeEmail('en', { kind: 'OFF', name: 'N', link: 'https://x' }, 'Smartly').text).toContain("If this wasn't you");
    expect(renderTwoStepNoticeEmail('en', { kind: 'OFF_BY_SUPPORT', name: 'N', link: 'https://x' }, 'Smartly').text).not.toContain("If this wasn't you");
  });
});
