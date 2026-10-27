import { escapeHtml } from './escape-html.js';

export interface OneTimeCodeEmail {
  name: string;
  code: string;
  // What the code confirms, already worded for the reader ("withdraw
  // ৳ 1,000 to bKash").
  action: string;
  minutes: number;
}

// The six-digit code a customer types to confirm something sensitive (a
// referral withdrawal), in their language.
export function renderOneTimeCodeEmail(locale: 'en' | 'bn', email: OneTimeCodeEmail, platformName: string): { subject: string; html: string; text: string } {
  const en = locale === 'en';
  const subject = en ? `Your code: ${email.code}` : `আপনার কোড: ${email.code}`;
  const greeting = en ? `Hi ${email.name},` : `প্রিয় ${email.name},`;
  const body = en ? `Enter this code to ${email.action}:` : `${email.action} নিশ্চিত করতে এই কোডটি দিন:`;
  const expiry = en ? `It works once, for ${email.minutes} minutes.` : `কোডটি একবারই কাজ করবে, ${email.minutes} মিনিটের জন্য।`;
  const warning = en
    ? `Never share this code. ${platformName} staff will never ask you for it. If you didn't ask for it, change your password.`
    : `এই কোড কাউকে দেবেন না। ${platformName}-এর কেউ কখনো এটি চাইবে না। আপনি না চাইলে পাসওয়ার্ড বদলে ফেলুন।`;

  const text = [greeting, '', body, '', email.code, '', expiry, warning, '', `- ${platformName}`].join('\n');
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto;">
      <p style="color: #374151; font-size: 14px; line-height: 1.6;">${escapeHtml(greeting)}</p>
      <p style="color: #374151; font-size: 14px; line-height: 1.6;">${escapeHtml(body)}</p>
      <p style="color: #111827; font-size: 28px; font-weight: 700; letter-spacing: 6px; margin: 16px 0;">${escapeHtml(email.code)}</p>
      <p style="color: #374151; font-size: 14px; line-height: 1.6;">${escapeHtml(expiry)}</p>
      <p style="color: #6b7280; font-size: 13px; line-height: 1.6;">${escapeHtml(warning)}</p>
      <p style="color: #9ca3af; font-size: 12px; margin-top: 32px;">${escapeHtml(platformName)}</p>
    </div>
  `;
  return { subject, html, text };
}
