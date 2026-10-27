import { escapeHtml } from './escape-html.js';

export interface NewDeviceEmail {
  name: string;
  // "Chrome on Windows"
  deviceLabel: string;
  // The country the IP address is in, or null when it can't be placed.
  place: string | null;
  ipAddress: string;
  // When, already worded for the reader on the Dhaka clock ("28 Oct 2026, 3:05 pm").
  time: string;
  // Settings > Security in the app.
  link: string;
}

// Settings > Security > Alerts > "Email me when a new device signs in": a
// sign-in from a device this account has never used, in the customer's
// language, so someone else using the password is noticed at once.
export function renderNewDeviceEmail(locale: 'en' | 'bn', email: NewDeviceEmail, platformName: string): { subject: string; html: string; text: string } {
  const en = locale === 'en';
  const subject = en ? 'New sign-in to your account' : 'আপনার অ্যাকাউন্টে নতুন সাইন-ইন';
  const greeting = en ? `Hi ${email.name},` : `প্রিয় ${email.name},`;
  const body = en
    ? 'Your account was just signed in to from a device we have not seen before.'
    : 'এইমাত্র এমন একটি ডিভাইস থেকে আপনার অ্যাকাউন্টে সাইন-ইন হয়েছে, যা আগে দেখা যায়নি।';
  const where = email.place ? `${email.place} · ${email.ipAddress}` : email.ipAddress;
  const rows: [string, string][] = en
    ? [
        ['Device', email.deviceLabel],
        ['Where (approximate)', where],
        ['When', email.time],
      ]
    : [
        ['ডিভাইস', email.deviceLabel],
        ['কোথা থেকে (আনুমানিক)', where],
        ['কখন', email.time],
      ];
  const fine = en ? 'If this was you, there is nothing to do.' : 'এটি আপনি হলে কিছু করার দরকার নেই।';
  const warning = en
    ? "If this wasn't you, change your password now and sign that device out in Settings > Security."
    : 'এটি আপনি না হলে এখনই পাসওয়ার্ড বদলান এবং সেটিংস > নিরাপত্তা থেকে ওই ডিভাইসটি সাইন-আউট করুন।';
  const button = en ? 'Open security settings' : 'নিরাপত্তা সেটিংস খুলুন';

  const text = [greeting, '', body, '', ...rows.map(([label, value]) => `${label}: ${value}`), '', fine, warning, '', email.link, '', `- ${platformName}`].join(
    '\n',
  );
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto;">
      <h2 style="color: #111827;">${escapeHtml(subject)}</h2>
      <p style="color: #374151; font-size: 14px; line-height: 1.6;">${escapeHtml(greeting)}</p>
      <p style="color: #374151; font-size: 14px; line-height: 1.6;">${escapeHtml(body)}</p>
      <table style="font-size: 14px; color: #374151; border-collapse: collapse; margin: 12px 0;">
        ${rows.map(([label, value]) => `<tr><td style="padding: 4px 16px 4px 0; color: #6b7280;">${escapeHtml(label)}</td><td style="padding: 4px 0;">${escapeHtml(value)}</td></tr>`).join('')}
      </table>
      <p style="color: #374151; font-size: 14px; line-height: 1.6;">${escapeHtml(fine)}</p>
      <p style="color: #6b7280; font-size: 13px; line-height: 1.6;">${escapeHtml(warning)}</p>
      <p style="margin: 24px 0;">
        <a href="${escapeHtml(email.link)}" style="background-color: #1C7567; color: #ffffff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600; display: inline-block;">${escapeHtml(button)}</a>
      </p>
      <p style="color: #9ca3af; font-size: 12px; margin-top: 32px;">${escapeHtml(platformName)}</p>
    </div>
  `;
  return { subject, html, text };
}
