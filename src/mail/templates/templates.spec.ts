import { renderPasswordResetEmail } from './password-reset-email.js';
import { renderSupportReplyEmail } from './support-reply-email.js';
import { renderWelcomeEmail } from './welcome-email.js';

const OLD_NAME = 'Money Management Tracker';

const templates = {
  welcome: (platformName: string) => renderWelcomeEmail('Nadia', platformName),
  'password reset': (platformName: string) => renderPasswordResetEmail('Nadia', 'https://app.example/reset-password?token=abc', platformName),
  'support reply': (platformName: string) => renderSupportReplyEmail('Nadia', 'Export failed', 'Fixed now.', 'https://app.example/settings/help?message=t1', platformName),
};

describe.each(Object.entries(templates))('the %s email', (_label, render) => {
  it('signs off with the given platform name and never the old one', () => {
    const email = render('Smartly');
    expect(email.text).toContain('- Smartly');
    expect(email.html).toContain('Smartly');
    for (const part of [email.subject, email.text, email.html]) {
      expect(part).not.toContain(OLD_NAME);
    }
  });

  it('uses whatever name it is given', () => {
    const email = render('Acme Books');
    expect(email.text).toContain('Acme Books');
    expect(email.html).toContain('Acme Books');
    expect(`${email.subject}${email.text}${email.html}`).not.toContain('Smartly');
  });

  it('escapes the name in the HTML', () => {
    const email = render('<b>Acme</b>');
    expect(email.html).toContain('&lt;b&gt;Acme&lt;/b&gt;');
    expect(email.html).not.toContain('<b>Acme</b>');
  });
});

describe('subjects', () => {
  it('welcomes the user to the platform by name', () => {
    expect(renderWelcomeEmail('Nadia', 'Smartly').subject).toBe('Welcome to Smartly');
  });

  it('keeps the password reset and support reply subjects as they were', () => {
    expect(renderPasswordResetEmail('Nadia', 'https://x', 'Smartly').subject).toBe('Reset your password');
    expect(renderSupportReplyEmail('Nadia', 'Export failed', 'ok', 'https://x', 'Smartly').subject).toBe('Re: Export failed');
  });

  it('signs a support reply from the platform support team', () => {
    const email = renderSupportReplyEmail('Nadia', 'Export failed', 'ok', 'https://x', 'Smartly');
    expect(email.text.endsWith('- Smartly support')).toBe(true);
    expect(email.html).toContain('Smartly support</p>');
  });
});
