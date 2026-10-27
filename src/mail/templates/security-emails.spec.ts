import { renderFailedTriesEmail } from './failed-tries-email.js';
import { renderMonthlySummaryEmail, type MonthlySummaryEmail } from './monthly-summary-email.js';
import { renderNewDeviceEmail } from './new-device-email.js';
import { renderVerifyEmail } from './verify-email.js';

const SUMMARY: MonthlySummaryEmail = {
  name: 'Nadia',
  month: 'October 2026',
  workspaceName: 'Personal',
  income: '50,000',
  expenses: '44,500.50',
  net: '5,499.50',
  netNegative: false,
  saved: '5,000',
  topExpenses: [{ name: 'Rent', amount: '25,000' }],
  link: 'https://x/reports/overview',
  settingsLink: 'https://x/settings/app',
};

const templates = {
  'verify email': (locale: 'en' | 'bn') => renderVerifyEmail(locale, { name: 'Nadia <b>', link: 'https://x/verify-email?token=t', hours: 24 }, 'Smartly'),
  'new device': (locale: 'en' | 'bn') =>
    renderNewDeviceEmail(
      locale,
      {
        name: 'Nadia <b>',
        deviceLabel: 'Chrome on Windows',
        place: 'Bangladesh',
        ipAddress: '103.4.145.1',
        time: '28 Oct 2026, 3:05 pm',
        link: 'https://x/settings/security',
      },
      'Smartly',
    ),
  'failed tries': (locale: 'en' | 'bn') =>
    renderFailedTriesEmail(
      locale,
      {
        name: 'Nadia <b>',
        count: 6,
        time: '28 Oct 2026, 3:05 pm',
        ipAddress: '203.0.113.7',
        place: null,
        resetLink: 'https://x/forgot-password',
        securityLink: 'https://x/settings/security',
      },
      'Smartly',
    ),
  'monthly summary': (locale: 'en' | 'bn') => renderMonthlySummaryEmail(locale, { ...SUMMARY, name: 'Nadia <b>' }, 'Smartly'),
};

describe.each(Object.entries(templates))('the %s email', (_label, render) => {
  it.each(['en', 'bn'] as const)('in %s signs off, links out and escapes the name', (locale) => {
    const email = render(locale);
    expect(email.subject.length).toBeGreaterThan(0);
    expect(email.text).toContain('- Smartly');
    expect(email.text).toContain('https://x/');
    expect(email.html).toContain('Nadia &lt;b&gt;');
    expect(email.html).not.toContain('Nadia <b>');
  });
});

describe('the alert emails', () => {
  it('give the count in Bangla digits', () => {
    expect(templates['failed tries']('bn').text).toContain('৬ বার');
  });

  it('show the place beside the IP when known', () => {
    expect(templates['new device']('en').text).toContain('Bangladesh · 103.4.145.1');
  });

  it('word an overspent month', () => {
    expect(renderMonthlySummaryEmail('en', { ...SUMMARY, netNegative: true }, 'Smartly').text).toContain('Spent more than earned: ৳ 5,499.50');
  });
});
