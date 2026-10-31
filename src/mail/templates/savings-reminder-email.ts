import { escapeHtml } from './escape-html.js';

export interface SavingsReminderEmail {
  name: string;
  goalName: string;
  // The reminder the customer set on the goal, or Catch up's monthly one.
  kind: 'DATE' | 'MONTHLY';
  // Amounts already formatted for the reader ("12,50,000"), without the ৳.
  saved: string;
  target: string;
  // What it takes each month from now to finish on time; null when the
  // goal is paused or has reached its target.
  perMonth: string | null;
  // "30 Jun 2027" / "৩০ জুন ২০২৭".
  endDate: string;
  link: string;
}

// A savings goal's reminder: the day the customer picked on the goal, or
// on the 1st of each month after Catch up's "save the needed amount a
// month from now". Sent in the reader's language.
export function renderSavingsReminderEmail(locale: 'en' | 'bn', email: SavingsReminderEmail, platformName: string): { subject: string; html: string; text: string } {
  const en = locale === 'en';
  const taka = (amount: string) => `৳ ${amount}`;
  const subject = en ? `Reminder: ${email.goalName}` : `মনে করিয়ে দিচ্ছি: ${email.goalName}`;
  const greeting = en ? `Hi ${email.name},` : `প্রিয় ${email.name},`;
  const lead =
    email.kind === 'MONTHLY'
      ? en
        ? `A new month has started. To keep ${email.goalName} on plan, put money aside this month.`
        : `নতুন মাস শুরু হয়েছে। ${email.goalName} পরিকল্পনামতো রাখতে এই মাসে টাকা জমান।`
      : en
        ? `You asked us to remind you about ${email.goalName} today.`
        : `আজ ${email.goalName}-এর কথা মনে করিয়ে দিতে বলেছিলেন।`;
  const rows: [string, string][] = en
    ? [
        ['Saved', `${taka(email.saved)} of ${taka(email.target)}`],
        ...(email.perMonth ? ([['Save each month', taka(email.perMonth)]] as [string, string][]) : []),
        ['End date', email.endDate],
      ]
    : [
        ['জমেছে', `${taka(email.target)}-এর মধ্যে ${taka(email.saved)}`],
        ...(email.perMonth ? ([['প্রতি মাসে জমান', taka(email.perMonth)]] as [string, string][]) : []),
        ['শেষ তারিখ', email.endDate],
      ];
  const button = en ? 'Open my goals' : 'আমার লক্ষ্যগুলো খুলুন';
  const why = en
    ? 'You get this email because a reminder is set on this goal. Change it from the goal in the app.'
    : 'এই লক্ষ্যে রিমাইন্ডার দেওয়া আছে বলে এই ইমেইল পাচ্ছেন। অ্যাপে লক্ষ্যটি থেকে বদলাতে পারবেন।';

  const text = [greeting, '', lead, '', ...rows.map(([label, value]) => `${label}: ${value}`), '', email.link, '', why, '', `- ${platformName}`].join('\n');
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto;">
      <h2 style="color: #111827;">${escapeHtml(subject)}</h2>
      <p style="color: #374151; font-size: 14px; line-height: 1.6;">${escapeHtml(greeting)}</p>
      <p style="color: #374151; font-size: 14px; line-height: 1.6;">${escapeHtml(lead)}</p>
      <table style="font-size: 14px; color: #374151; border-collapse: collapse; margin: 12px 0; width: 100%;">
        ${rows.map(([label, value]) => `<tr><td style="padding: 6px 0; color: #6b7280;">${escapeHtml(label)}</td><td style="padding: 6px 0; text-align: right; font-weight: 600;">${escapeHtml(value)}</td></tr>`).join('')}
      </table>
      <p style="margin: 20px 0;"><a href="${escapeHtml(email.link)}" style="background: #1C7567; color: #ffffff; padding: 10px 18px; border-radius: 999px; text-decoration: none; font-size: 14px; font-weight: 600;">${escapeHtml(button)}</a></p>
      <p style="color: #6b7280; font-size: 12px; line-height: 1.6;">${escapeHtml(why)}</p>
      <p style="color: #6b7280; font-size: 12px;">- ${escapeHtml(platformName)}</p>
    </div>`;
  return { subject, html, text };
}
