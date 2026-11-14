import { escapeHtml } from './escape-html.js';

export interface ReferralStatementEmail {
  name: string;
  // The month it covers, named for the locale ("October 2026").
  month: string;
  // How many friends' payments earned a share that month.
  payments: number;
  // Already formatted for the locale ("687.60" / "৬৮৭.৬০").
  earned: string;
  // What is ready to withdraw now, formatted for the locale.
  available: string;
  link: string;
}

// Sent on the 1st with last month's referral earnings (Referrals > Profile
// & payouts > "Monthly statement"), in the member's language.
export function renderReferralStatementEmail(locale: 'en' | 'bn', email: ReferralStatementEmail, platformName: string): { subject: string; html: string; text: string } {
  const en = locale === 'en';
  const subject = en ? `Your referral statement for ${email.month}` : `${email.month}-এর রেফারেল স্টেটমেন্ট`;
  const greeting = en ? `Hi ${email.name},` : `প্রিয় ${email.name},`;
  const lines = [
    en
      ? `In ${email.month} your friends made ${email.payments} ${email.payments === 1 ? 'payment' : 'payments'}, and your share was Tk ${email.earned}.`
      : `${email.month}-এ আপনার বন্ধুরা ${email.payments}টি পেমেন্ট করেছেন, আপনার ভাগ ৳ ${email.earned}।`,
    en ? `Ready to withdraw now: Tk ${email.available}.` : `এখন তোলা যাবে: ৳ ${email.available}।`,
  ];
  const action = en ? 'See your earnings' : 'আপনার আয় দেখুন';

  const text = [greeting, '', ...lines, '', `${action}: ${email.link}`, '', `- ${platformName}`].join('\n');
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto;">
      <p style="color: #374151; font-size: 14px; line-height: 1.6;">${escapeHtml(greeting)}</p>
      ${lines.map((line) => `<p style="color: #374151; font-size: 14px; line-height: 1.6;">${escapeHtml(line)}</p>`).join('\n      ')}
      <p style="margin-top: 24px;"><a href="${escapeHtml(email.link)}" style="color: #1F7A5A; font-weight: 600;">${escapeHtml(action)}</a></p>
      <p style="color: #9ca3af; font-size: 12px; margin-top: 32px;">${escapeHtml(platformName)}</p>
    </div>
  `;
  return { subject, html, text };
}
