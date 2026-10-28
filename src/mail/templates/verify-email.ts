import { escapeHtml } from './escape-html.js';

export interface VerifyEmail {
  name: string;
  // <USER_FRONTEND_URL>/verify-email?token=...
  link: string;
  hours: number;
}

// Settings > Profile > "Send a verification email": the link that proves
// the address is the customer's own, in their language. It works signed
// out too, so opening it on a phone is enough.
export function renderVerifyEmail(locale: 'en' | 'bn', email: VerifyEmail, platformName: string): { subject: string; html: string; text: string } {
  const en = locale === 'en';
  const subject = en ? 'Confirm your email address' : 'আপনার ইমেইল ঠিকানা নিশ্চিত করুন';
  const greeting = en ? `Hi ${email.name},` : `প্রিয় ${email.name},`;
  const body = en
    ? `Open the link below to confirm this is your email address. It works once, for ${email.hours} hours.`
    : `এটি আপনার ইমেইল ঠিকানা কিনা নিশ্চিত করতে নিচের লিংকটি খুলুন। লিংকটি একবারই কাজ করবে, ${email.hours} ঘণ্টার জন্য।`;
  const ignore = en
    ? "If you didn't ask for this, you can ignore this email. Nothing changes on your account."
    : 'আপনি এটি না চাইলে ইমেইলটি এড়িয়ে যান। আপনার অ্যাকাউন্টে কিছুই বদলাবে না।';
  const button = en ? 'Confirm my email' : 'ইমেইল নিশ্চিত করুন';

  const text = [greeting, '', body, '', email.link, '', ignore, '', `- ${platformName}`].join('\n');
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto;">
      <h2 style="color: #111827;">${escapeHtml(subject)}</h2>
      <p style="color: #374151; font-size: 14px; line-height: 1.6;">${escapeHtml(greeting)}</p>
      <p style="color: #374151; font-size: 14px; line-height: 1.6;">${escapeHtml(body)}</p>
      <p style="margin: 24px 0;">
        <a href="${escapeHtml(email.link)}" style="background-color: #1C7567; color: #ffffff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600; display: inline-block;">${escapeHtml(button)}</a>
      </p>
      <p style="color: #6b7280; font-size: 13px; line-height: 1.6;">${escapeHtml(ignore)}</p>
      <p style="color: #9ca3af; font-size: 12px; margin-top: 32px;">${escapeHtml(platformName)}</p>
    </div>
  `;
  return { subject, html, text };
}
