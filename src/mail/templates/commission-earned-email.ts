import { escapeHtml } from './escape-html.js';

export interface CommissionEarnedEmail {
  name: string;
  // The invited friend.
  friendName: string;
  // Already formatted for the locale ("343.80" / "৩৪৩.৮০").
  amount: string;
  // The Dhaka date it is ready to withdraw, formatted for the locale.
  readyOn: string;
  // A renewal rather than the friend's first payment.
  renewal: boolean;
  link: string;
}

// Sent when an invited friend's payment earns the member a commission
// (Referrals > Profile & payouts > "When a friend pays"), in their language.
export function renderCommissionEarnedEmail(
  locale: 'en' | 'bn',
  email: CommissionEarnedEmail,
  platformName: string,
): { subject: string; html: string; text: string } {
  const en = locale === 'en';
  const subject = en ? `You earned Tk ${email.amount} from ${email.friendName}` : `${email.friendName}-এর কাছ থেকে আপনি ৳ ${email.amount} আয় করেছেন`;
  const greeting = en ? `Hi ${email.name},` : `প্রিয় ${email.name},`;
  const lines = [
    email.renewal
      ? en
        ? `${email.friendName} renewed their plan, and your commission is Tk ${email.amount}.`
        : `${email.friendName} তাঁর প্ল্যান নবায়ন করেছেন, আপনার কমিশন ৳ ${email.amount}।`
      : en
        ? `${email.friendName} bought a plan with your invite, and your commission is Tk ${email.amount}.`
        : `${email.friendName} আপনার আমন্ত্রণে প্ল্যান কিনেছেন, আপনার কমিশন ৳ ${email.amount}।`,
    en ? `It is ready to withdraw on ${email.readyOn}, after the refund window.` : `রিফান্ডের সময় শেষ হলে ${email.readyOn} তারিখে এটি তোলা যাবে।`,
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
