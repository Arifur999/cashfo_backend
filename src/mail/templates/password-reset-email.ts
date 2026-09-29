import { escapeHtml } from './escape-html.js';

export function renderPasswordResetEmail(name: string, resetUrl: string): { subject: string; html: string; text: string } {
  const subject = 'Reset your password';
  const text = `Hi ${name},\n\nWe received a request to reset your password. Click the link below to choose a new one (this link expires in 30 minutes):\n\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email -- your password won't change.\n\n- Money Management Tracker`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #111827;">Reset your password</h2>
      <p style="color: #374151; font-size: 14px; line-height: 1.6;">
        Hi ${escapeHtml(name)}, we received a request to reset your password. Click the button below to
        choose a new one. This link expires in 30 minutes.
      </p>
      <p style="margin: 24px 0;">
        <a href="${resetUrl}" style="background-color: #2c8655; color: #ffffff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600; display: inline-block;">
          Reset Password
        </a>
      </p>
      <p style="color: #9ca3af; font-size: 12px; line-height: 1.6;">
        If you didn't request this, you can safely ignore this email -- your password won't change.
      </p>
      <p style="color: #9ca3af; font-size: 12px; margin-top: 32px;">Money Management Tracker</p>
    </div>
  `;
  return { subject, html, text };
}
