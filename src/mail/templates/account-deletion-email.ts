import { escapeHtml } from './escape-html.js';

export interface AccountDeletionEmail {
  name: string;
  // 'D MMM YYYY' in the reader's language, already formatted.
  deletionDate: string;
  // The app's sign-in page.
  link: string;
}

// "Your account will be deleted on <date>": sent when the owner asks to
// delete their account, so a request they didn't make can still be undone
// by signing in.
export function renderAccountDeletionEmail(locale: 'en' | 'bn', email: AccountDeletionEmail, platformName: string): { subject: string; html: string; text: string } {
  const en = locale === 'en';
  const subject = en ? 'Your account will be deleted' : 'আপনার অ্যাকাউন্ট মুছে ফেলা হবে';
  const greeting = en ? `Hi ${email.name},` : `প্রিয় ${email.name},`;
  const body = en
    ? `You asked us to delete your ${platformName} account. It is locked now, and on ${email.deletionDate} it and everything in it will be deleted for good.`
    : `আপনি আপনার ${platformName} অ্যাকাউন্ট মুছে ফেলতে বলেছেন। অ্যাকাউন্টটি এখন বন্ধ আছে, আর ${email.deletionDate} তারিখে এটি ও এর সব তথ্য চিরতরে মুছে যাবে।`;
  const keep = en
    ? `Changed your mind? Sign in before ${email.deletionDate} and your account comes back as it was.`
    : `মত বদলেছেন? ${email.deletionDate} তারিখের আগে সাইন-ইন করুন, অ্যাকাউন্ট আগের মতোই ফিরে আসবে।`;
  const warning = en
    ? "If you didn't ask for this, sign in now and change your password."
    : 'আপনি এটি না চেয়ে থাকলে এখনই সাইন-ইন করে পাসওয়ার্ড বদলান।';
  const button = en ? 'Sign in to keep my account' : 'সাইন-ইন করে অ্যাকাউন্ট রাখুন';

  const text = [greeting, '', body, '', keep, '', warning, '', email.link, '', `- ${platformName}`].join('\n');
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto;">
      <h2 style="color: #111827;">${escapeHtml(subject)}</h2>
      <p style="color: #374151; font-size: 14px; line-height: 1.6;">${escapeHtml(greeting)}</p>
      <p style="color: #374151; font-size: 14px; line-height: 1.6;">${escapeHtml(body)}</p>
      <p style="color: #374151; font-size: 14px; line-height: 1.6;">${escapeHtml(keep)}</p>
      <p style="margin: 24px 0;">
        <a href="${escapeHtml(email.link)}" style="background-color: #1C7567; color: #ffffff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600; display: inline-block;">${escapeHtml(button)}</a>
      </p>
      <p style="color: #6b7280; font-size: 13px; line-height: 1.6;">${escapeHtml(warning)}</p>
      <p style="color: #9ca3af; font-size: 12px; margin-top: 32px;">${escapeHtml(platformName)}</p>
    </div>
  `;
  return { subject, html, text };
}
