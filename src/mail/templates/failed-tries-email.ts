import { escapeHtml } from './escape-html.js';

export interface FailedTriesEmail {
  name: string;
  // Wrong passwords (and wrong two-step codes) in the last 15 minutes.
  count: number;
  // When the last one was, already worded for the reader on the Dhaka clock.
  time: string;
  ipAddress: string;
  place: string | null;
  // The app's "Forgot password?" page and Settings > Security.
  resetLink: string;
  securityLink: string;
}

// Settings > Security > Alerts > "Warn me about unusual sign-in tries":
// many wrong passwords in a row, at most one email an hour.
export function renderFailedTriesEmail(locale: 'en' | 'bn', email: FailedTriesEmail, platformName: string): { subject: string; html: string; text: string } {
  const en = locale === 'en';
  const count = en ? String(email.count) : toBnDigits(String(email.count));
  const subject = en ? 'Several wrong sign-in tries on your account' : 'আপনার অ্যাকাউন্টে কয়েকবার ভুল সাইন-ইনের চেষ্টা';
  const greeting = en ? `Hi ${email.name},` : `প্রিয় ${email.name},`;
  const body = en
    ? `Someone tried to sign in to your account ${count} times in the last 15 minutes with the wrong password or code.`
    : `গত ১৫ মিনিটে কেউ ভুল পাসওয়ার্ড বা কোড দিয়ে ${count} বার আপনার অ্যাকাউন্টে সাইন-ইনের চেষ্টা করেছে।`;
  const where = email.place ? `${email.place} · ${email.ipAddress}` : email.ipAddress;
  const rows: [string, string][] = en
    ? [
        ['Last try', email.time],
        ['From (approximate)', where],
      ]
    : [
        ['শেষ চেষ্টা', email.time],
        ['কোথা থেকে (আনুমানিক)', where],
      ];
  const you = en ? 'If this was you and you forgot your password, you can reset it.' : 'এটি আপনি হলে এবং পাসওয়ার্ড ভুলে গেলে, পাসওয়ার্ড রিসেট করতে পারেন।';
  const notYou = en
    ? 'If it was not you, your account is still safe: nobody got in. To be safer, turn on two-step sign-in in Settings > Security.'
    : 'এটি আপনি না হলেও আপনার অ্যাকাউন্ট নিরাপদ আছে: কেউ ঢুকতে পারেনি। আরও নিরাপদ থাকতে সেটিংস > নিরাপত্তা থেকে দুই ধাপে সাইন-ইন চালু করুন।';
  const resetButton = en ? 'Reset my password' : 'পাসওয়ার্ড রিসেট করুন';
  const securityButton = en ? 'Open security settings' : 'নিরাপত্তা সেটিংস খুলুন';

  const text = [
    greeting,
    '',
    body,
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    you,
    email.resetLink,
    '',
    notYou,
    email.securityLink,
    '',
    `- ${platformName}`,
  ].join('\n');
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto;">
      <h2 style="color: #111827;">${escapeHtml(subject)}</h2>
      <p style="color: #374151; font-size: 14px; line-height: 1.6;">${escapeHtml(greeting)}</p>
      <p style="color: #374151; font-size: 14px; line-height: 1.6;">${escapeHtml(body)}</p>
      <table style="font-size: 14px; color: #374151; border-collapse: collapse; margin: 12px 0;">
        ${rows.map(([label, value]) => `<tr><td style="padding: 4px 16px 4px 0; color: #6b7280;">${escapeHtml(label)}</td><td style="padding: 4px 0;">${escapeHtml(value)}</td></tr>`).join('')}
      </table>
      <p style="color: #374151; font-size: 14px; line-height: 1.6;">${escapeHtml(you)}</p>
      <p style="color: #374151; font-size: 14px; line-height: 1.6;">${escapeHtml(notYou)}</p>
      <p style="margin: 24px 0;">
        <a href="${escapeHtml(email.securityLink)}" style="background-color: #1C7567; color: #ffffff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600; display: inline-block;">${escapeHtml(securityButton)}</a>
        <a href="${escapeHtml(email.resetLink)}" style="color: #1C7567; padding: 12px 16px; text-decoration: none; font-size: 14px; font-weight: 600; display: inline-block;">${escapeHtml(resetButton)}</a>
      </p>
      <p style="color: #9ca3af; font-size: 12px; margin-top: 32px;">${escapeHtml(platformName)}</p>
    </div>
  `;
  return { subject, html, text };
}

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
const toBnDigits = (text: string): string => text.replace(/\d/g, (digit) => BN_DIGITS[Number(digit)]);
