import { escapeHtml } from './escape-html.js';

export interface MonthlySummaryEmail {
  name: string;
  // "October 2026" / "অক্টোবর ২০২৬"
  month: string;
  workspaceName: string;
  // Amounts already formatted for the reader ("12,50,000"), without the ৳.
  income: string;
  expenses: string;
  net: string;
  // Net is below zero: spent more than came in.
  netNegative: boolean;
  saved: string;
  // The month's largest expense categories, at most three.
  topExpenses: { name: string; amount: string }[];
  // The app's reports, and Settings > App to stop these emails.
  link: string;
  settingsLink: string;
}

// Settings > App > Reminders > "Monthly summary by email": last month's
// income, spending and savings for the customer's own workspace, sent on
// the 1st in their language.
export function renderMonthlySummaryEmail(
  locale: 'en' | 'bn',
  email: MonthlySummaryEmail,
  platformName: string,
): { subject: string; html: string; text: string } {
  const en = locale === 'en';
  const subject = en ? `Your ${email.month} summary` : `আপনার ${email.month} মাসের সারসংক্ষেপ`;
  const greeting = en ? `Hi ${email.name},` : `প্রিয় ${email.name},`;
  const body = en ? `Here is how ${email.month} went in ${email.workspaceName}.` : `${email.workspaceName}-এ ${email.month} মাস যেমন গেল:`;
  const taka = (amount: string) => `৳ ${amount}`;
  const rows: [string, string][] = en
    ? [
        ['Income', taka(email.income)],
        ['Spending', taka(email.expenses)],
        [email.netNegative ? 'Spent more than earned' : 'Left over', taka(email.net)],
        ['Put into savings goals', taka(email.saved)],
      ]
    : [
        ['আয়', taka(email.income)],
        ['খরচ', taka(email.expenses)],
        [email.netNegative ? 'আয়ের চেয়ে বেশি খরচ' : 'বাকি রইল', taka(email.net)],
        ['সঞ্চয় লক্ষ্যে জমা', taka(email.saved)],
      ];
  const topTitle = en ? 'Where most of the money went' : 'সবচেয়ে বেশি খরচ যেখানে';
  const button = en ? 'Open my reports' : 'আমার রিপোর্ট খুলুন';
  const stop = en
    ? 'You get this email because the monthly summary is on in Settings > App.'
    : 'সেটিংস > অ্যাপ-এ মাসিক সারসংক্ষেপ চালু আছে বলে এই ইমেইল পাচ্ছেন।';
  const stopLink = en ? 'Turn it off' : 'বন্ধ করুন';
  const top = email.topExpenses;

  const text = [
    greeting,
    '',
    body,
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    ...(top.length > 0 ? ['', `${topTitle}:`, ...top.map((row) => `- ${row.name}: ${taka(row.amount)}`)] : []),
    '',
    email.link,
    '',
    stop,
    email.settingsLink,
    '',
    `- ${platformName}`,
  ].join('\n');
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto;">
      <h2 style="color: #111827;">${escapeHtml(subject)}</h2>
      <p style="color: #374151; font-size: 14px; line-height: 1.6;">${escapeHtml(greeting)}</p>
      <p style="color: #374151; font-size: 14px; line-height: 1.6;">${escapeHtml(body)}</p>
      <table style="font-size: 14px; color: #374151; border-collapse: collapse; margin: 12px 0; width: 100%;">
        ${rows.map(([label, value]) => `<tr><td style="padding: 6px 0; color: #6b7280;">${escapeHtml(label)}</td><td style="padding: 6px 0; text-align: right; font-weight: 600;">${escapeHtml(value)}</td></tr>`).join('')}
      </table>
      ${
        top.length > 0
          ? `<p style="color: #111827; font-size: 14px; font-weight: 600; margin-top: 20px;">${escapeHtml(topTitle)}</p>
      <table style="font-size: 14px; color: #374151; border-collapse: collapse; width: 100%;">
        ${top.map((row) => `<tr><td style="padding: 4px 0;">${escapeHtml(row.name)}</td><td style="padding: 4px 0; text-align: right;">${escapeHtml(taka(row.amount))}</td></tr>`).join('')}
      </table>`
          : ''
      }
      <p style="margin: 24px 0;">
        <a href="${escapeHtml(email.link)}" style="background-color: #1C7567; color: #ffffff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600; display: inline-block;">${escapeHtml(button)}</a>
      </p>
      <p style="color: #9ca3af; font-size: 12px; line-height: 1.6;">${escapeHtml(stop)} <a href="${escapeHtml(email.settingsLink)}" style="color: #6b7280;">${escapeHtml(stopLink)}</a></p>
      <p style="color: #9ca3af; font-size: 12px; margin-top: 32px;">${escapeHtml(platformName)}</p>
    </div>
  `;
  return { subject, html, text };
}
