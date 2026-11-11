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
  // A day's or a week's summary (Settings › Notifications) instead of a
  // month's; `month` then names the day or the week.
  kind?: 'month' | 'day' | 'week';
  // What is due next ("Pay Islami Bank ৳ 5,000 on 15 Nov"), at most a few.
  upcoming?: string[];
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
  const kind = email.kind ?? 'month';
  const subject =
    kind === 'month'
      ? en
        ? `Your ${email.month} summary`
        : `আপনার ${email.month} মাসের সারসংক্ষেপ`
      : en
        ? `Your ${kind === 'day' ? 'day' : 'week'}: ${email.month}`
        : `আপনার ${kind === 'day' ? 'দিন' : 'সপ্তাহ'}: ${email.month}`;
  const greeting = en ? `Hi ${email.name},` : `প্রিয় ${email.name},`;
  const body = en ? `Here is how ${email.month} went in ${email.workspaceName}.` : `${email.workspaceName}-এ ${email.month}${kind === 'month' ? ' মাস' : ''} যেমন গেল:`;
  const taka = (amount: string) => `${en ? 'Tk' : '৳'} ${amount}`;
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
  const stop =
    kind === 'month'
      ? en
        ? 'You get this email because the monthly summary is on in Settings > App.'
        : 'সেটিংস > অ্যাপ-এ মাসিক সারসংক্ষেপ চালু আছে বলে এই ইমেইল পাচ্ছেন।'
      : en
        ? `You get this email because the ${kind === 'day' ? 'daily' : 'weekly'} summary is on in Settings > Notifications.`
        : `সেটিংস > নোটিফিকেশনে ${kind === 'day' ? 'দৈনিক' : 'সাপ্তাহিক'} সারাংশ চালু আছে বলে এই ইমেইল পাচ্ছেন।`;
  const upcomingTitle = en ? 'Coming up' : 'সামনে যা আছে';
  const upcoming = email.upcoming ?? [];
  const stopLink = en ? 'Turn it off' : 'বন্ধ করুন';
  const top = email.topExpenses;

  const text = [
    greeting,
    '',
    body,
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    ...(top.length > 0 ? ['', `${topTitle}:`, ...top.map((row) => `- ${row.name}: ${taka(row.amount)}`)] : []),
    ...(upcoming.length > 0 ? ['', `${upcomingTitle}:`, ...upcoming.map((line) => `- ${line}`)] : []),
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
      ${
        upcoming.length > 0
          ? `<p style="color: #111827; font-size: 14px; font-weight: 600; margin-top: 20px;">${escapeHtml(upcomingTitle)}</p>
      <ul style="font-size: 14px; color: #374151; padding-left: 18px;">${upcoming.map((line) => `<li style="padding: 2px 0;">${escapeHtml(line)}</li>`).join('')}</ul>`
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
