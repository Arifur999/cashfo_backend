import { escapeHtml } from './escape-html.js';

export interface AdminInviteEmail {
  // The invited person's name when the super admin typed one.
  name: string | null;
  inviterName: string;
  role: { en: string; bn: string };
  // <ADMIN_FRONTEND_URL>/admin/invite?token=...
  link: string;
  // "8 Oct 2026" / "৮ অক্টোবর ২০২৬"
  expires: { en: string; bn: string };
}

// The invite to the admin team. The person has no account yet, so no known
// language: the email says it in English, then in Bangla.
export function renderAdminInviteEmail(invite: AdminInviteEmail, platformName: string): { subject: string; html: string; text: string } {
  const subject = `${invite.inviterName} invited you to the ${platformName} admin team`;
  const en = {
    greeting: invite.name ? `Hi ${invite.name},` : 'Hi,',
    body: `${invite.inviterName} invited you to join the ${platformName} admin panel as ${invite.role.en}. Open the link to choose your name and password and set up two-step sign-in with an authenticator app.`,
    expiry: `The link works once and ends on ${invite.expires.en}.`,
    ignore: "If you weren't expecting this, you can ignore this email.",
    button: 'Join the admin team',
  };
  const bn = {
    greeting: invite.name ? `প্রিয় ${invite.name},` : 'প্রিয় সদস্য,',
    body: `${invite.inviterName} আপনাকে ${platformName} অ্যাডমিন প্যানেলে ${invite.role.bn} হিসেবে যোগ দিতে আমন্ত্রণ জানিয়েছেন। লিংকটি খুলে আপনার নাম ও পাসওয়ার্ড দিন এবং অথেনটিকেটর অ্যাপ দিয়ে দুই ধাপে সাইন-ইন চালু করুন।`,
    expiry: `লিংকটি একবারই কাজ করবে, ${invite.expires.bn} পর্যন্ত।`,
    ignore: 'আপনি এটি আশা না করলে এই ইমেইলটি উপেক্ষা করুন।',
  };

  const text = [
    en.greeting,
    '',
    en.body,
    '',
    invite.link,
    '',
    en.expiry,
    en.ignore,
    '',
    '---',
    '',
    bn.greeting,
    '',
    bn.body,
    '',
    bn.expiry,
    bn.ignore,
    '',
    `- ${platformName}`,
  ].join('\n');
  const paragraph = (value: string, color = '#374151') => `<p style="color: ${color}; font-size: 14px; line-height: 1.6;">${escapeHtml(value)}</p>`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto;">
      <h2 style="color: #111827;">${escapeHtml(subject)}</h2>
      ${paragraph(en.greeting)}
      ${paragraph(en.body)}
      <p style="margin: 24px 0;">
        <a href="${escapeHtml(invite.link)}" style="background-color: #1C7567; color: #ffffff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600; display: inline-block;">${escapeHtml(en.button)}</a>
      </p>
      ${paragraph(en.expiry)}
      ${paragraph(en.ignore, '#6b7280')}
      <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
      ${paragraph(bn.greeting)}
      ${paragraph(bn.body)}
      ${paragraph(bn.expiry)}
      ${paragraph(bn.ignore, '#6b7280')}
      <p style="color: #9ca3af; font-size: 12px; margin-top: 32px;">${escapeHtml(platformName)}</p>
    </div>
  `;
  return { subject, html, text };
}
