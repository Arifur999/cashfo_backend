import { escapeHtml } from './escape-html.js';

// Sent when the support team answers a customer's message, with the answer
// and a link back to the conversation in the app.
export function renderSupportReplyEmail(name: string, subject: string, reply: string, link: string, platformName: string): { subject: string; html: string; text: string } {
  const title = `Re: ${subject}`;
  const text = `Hi ${name},\n\nOur support team answered your message "${subject}":\n\n${reply}\n\nReply or read the whole conversation in the app: ${link}\n\n- ${platformName} support`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto;">
      <p style="color: #374151; font-size: 14px; line-height: 1.6;">Hi ${escapeHtml(name)},</p>
      <p style="color: #374151; font-size: 14px; line-height: 1.6;">Our support team answered your message <b>${escapeHtml(subject)}</b>:</p>
      <div style="color: #111827; font-size: 14px; line-height: 1.6; white-space: pre-wrap; border-left: 3px solid #1F7A5A; padding: 8px 12px; background: #F3FAF6;">${escapeHtml(reply)}</div>
      <p style="margin-top: 24px;"><a href="${escapeHtml(link)}" style="color: #1F7A5A; font-weight: 600;">Read or reply in the app</a></p>
      <p style="color: #9ca3af; font-size: 12px; margin-top: 32px;">${escapeHtml(platformName)} support</p>
    </div>
  `;
  return { subject: title, html, text };
}
