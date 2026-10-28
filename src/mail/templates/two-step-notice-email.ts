import { escapeHtml } from './escape-html.js';

export interface TwoStepNotice {
  // ON: the customer turned it on. OFF: they turned it off. OFF_BY_SUPPORT:
  // the support team turned it off for them (a lost phone).
  kind: 'ON' | 'OFF' | 'OFF_BY_SUPPORT';
  name: string;
  // Settings > Security in the app.
  link: string;
}

const COPY = {
  ON: {
    en: {
      subject: 'Two-step sign-in is on',
      body: 'Two-step sign-in is now on for your account. Each time you sign in on a new device, we will ask for the 6-digit code from your authenticator app.',
    },
    bn: {
      subject: 'দুই ধাপে সাইন-ইন চালু হয়েছে',
      body: 'আপনার অ্যাকাউন্টে দুই ধাপে সাইন-ইন এখন চালু। নতুন কোনো ডিভাইসে সাইন-ইন করার সময় আমরা আপনার অথেনটিকেটর অ্যাপের ৬ সংখ্যার কোড চাইব।',
    },
  },
  OFF: {
    en: { subject: 'Two-step sign-in is off', body: 'Two-step sign-in was turned off for your account. Your password alone now signs you in.' },
    bn: { subject: 'দুই ধাপে সাইন-ইন বন্ধ হয়েছে', body: 'আপনার অ্যাকাউন্টে দুই ধাপে সাইন-ইন বন্ধ করা হয়েছে। এখন শুধু পাসওয়ার্ড দিয়েই সাইন-ইন হবে।' },
  },
  OFF_BY_SUPPORT: {
    en: {
      subject: 'Two-step sign-in is off',
      body: 'Our support team turned off two-step sign-in for your account, as you asked. You can turn it on again in Settings > Security.',
    },
    bn: {
      subject: 'দুই ধাপে সাইন-ইন বন্ধ হয়েছে',
      body: 'আপনার অনুরোধে আমাদের সাপোর্ট টিম আপনার অ্যাকাউন্টে দুই ধাপে সাইন-ইন বন্ধ করেছে। সেটিংস > নিরাপত্তা থেকে আবার চালু করতে পারবেন।',
    },
  },
} as const;

// Tells a customer that two-step sign-in changed on their account, in their
// language. Whoever did not make the change gets to know at once.
export function renderTwoStepNoticeEmail(locale: 'en' | 'bn', notice: TwoStepNotice, platformName: string): { subject: string; html: string; text: string } {
  const en = locale === 'en';
  const { subject, body } = COPY[notice.kind][locale];
  const greeting = en ? `Hi ${notice.name},` : `প্রিয় ${notice.name},`;
  const warning = en
    ? "If this wasn't you, change your password now and turn two-step sign-in back on."
    : 'এটি আপনি না করে থাকলে এখনই পাসওয়ার্ড বদলান এবং দুই ধাপে সাইন-ইন আবার চালু করুন।';
  const button = en ? 'Open security settings' : 'নিরাপত্তা সেটিংস খুলুন';
  const showWarning = notice.kind !== 'OFF_BY_SUPPORT';

  const text = [greeting, '', body, ...(showWarning ? ['', warning] : []), '', notice.link, '', `- ${platformName}`].join('\n');
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto;">
      <h2 style="color: #111827;">${escapeHtml(subject)}</h2>
      <p style="color: #374151; font-size: 14px; line-height: 1.6;">${escapeHtml(greeting)}</p>
      <p style="color: #374151; font-size: 14px; line-height: 1.6;">${escapeHtml(body)}</p>
      ${showWarning ? `<p style="color: #6b7280; font-size: 13px; line-height: 1.6;">${escapeHtml(warning)}</p>` : ''}
      <p style="margin: 24px 0;">
        <a href="${escapeHtml(notice.link)}" style="background-color: #1C7567; color: #ffffff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600; display: inline-block;">${escapeHtml(button)}</a>
      </p>
      <p style="color: #9ca3af; font-size: 12px; margin-top: 32px;">${escapeHtml(platformName)}</p>
    </div>
  `;
  return { subject, html, text };
}
