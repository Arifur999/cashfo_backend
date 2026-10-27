import { escapeHtml } from './escape-html.js';

export interface AdminPasswordResetEmail {
  name: string;
  // <ADMIN_FRONTEND_URL>/admin/reset-password?token=...
  link: string;
  minutes: number;
}

// "Forgot password?" on the admin sign-in page, in the admin's language.
export function renderAdminPasswordResetEmail(
  locale: 'en' | 'bn',
  email: AdminPasswordResetEmail,
  platformName: string,
): { subject: string; html: string; text: string } {
  const en = locale === 'en';
  const subject = en ? `Reset your ${platformName} admin password` : `${platformName} অ্যাডমিন পাসওয়ার্ড রিসেট করুন`;
  const greeting = en ? `Hi ${email.name},` : `প্রিয় ${email.name},`;
  const body = en
    ? `We received a request to reset the password of your admin account. The link below works once, for ${email.minutes} minutes. Two-step sign-in stays on.`
    : `আপনার অ্যাডমিন অ্যাকাউন্টের পাসওয়ার্ড রিসেট করার অনুরোধ পেয়েছি। নিচের লিংকটি একবারই কাজ করবে, ${email.minutes} মিনিটের জন্য। দুই ধাপে সাইন-ইন চালুই থাকবে।`;
  const ignore = en
    ? "If you didn't ask for this, ignore this email -- your password won't change -- and tell a super admin."
    : 'আপনি এটি না চাইলে ইমেইলটি উপেক্ষা করুন (পাসওয়ার্ড বদলাবে না) এবং একজন সুপার অ্যাডমিনকে জানান।';
  const button = en ? 'Choose a new password' : 'নতুন পাসওয়ার্ড দিন';

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
