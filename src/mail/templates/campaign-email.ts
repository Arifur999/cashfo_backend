import { escapeHtml } from './escape-html.js';

export interface CampaignEmail {
  // Already filled in for this person (the template's {{placeholders}}).
  subject: string;
  body: string;
  // The app's address, for the "Open" link under the message.
  link: string;
}

// An admin campaign (Notifications > Campaigns) by email: the template's
// words as written, line breaks kept, every bit of it escaped -- the text
// and the person's own name inside it are free text.
export function renderCampaignEmail(locale: 'en' | 'bn', email: CampaignEmail, platformName: string): { subject: string; html: string; text: string } {
  const action = locale === 'bn' ? `${platformName} খুলুন` : `Open ${platformName}`;
  const text = `${email.body}\n\n${action}: ${email.link}\n\n- ${platformName}`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto;">
      <div style="color: #374151; font-size: 14px; line-height: 1.6; white-space: pre-wrap;">${escapeHtml(email.body)}</div>
      <p style="margin-top: 24px;"><a href="${escapeHtml(email.link)}" style="color: #1F7A5A; font-weight: 600;">${escapeHtml(action)}</a></p>
      <p style="color: #9ca3af; font-size: 12px; margin-top: 32px;">${escapeHtml(platformName)}</p>
    </div>
  `;
  return { subject: email.subject, html, text };
}
