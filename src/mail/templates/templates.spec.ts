import { renderBillingReceiptEmail } from './billing-receipt-email.js';
import { renderPasswordResetEmail } from './password-reset-email.js';
import { renderPlanNoticeEmail } from './plan-notice-email.js';
import { renderSupportReplyEmail } from './support-reply-email.js';
import { renderWelcomeEmail } from './welcome-email.js';

const OLD_NAME = 'Money Management Tracker';

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
