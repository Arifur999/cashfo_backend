import { escapeHtml } from './escape-html.js';

export interface PlanNotice {
  // ENDING: "your plan ends on ..." a few days ahead; ENDED: it ran out and
  // the account is back on the free plan.
  kind: 'ENDING' | 'ENDED';
  name: string;
  planName: string;
  trial: boolean;
  // "30 Oct 2026"
  date: string;
  link: string;
}

export function renderPlanNoticeEmail(locale: 'en' | 'bn', notice: PlanNotice, platformName: string): { subject: string; html: string; text: string } {
  const en = locale === 'en';
  const what = notice.trial
    ? en
      ? `Your ${notice.planName} trial`
      : `আপনার ${notice.planName} ট্রায়াল`
    : en
      ? `Your ${notice.planName} plan`
      : `আপনার ${notice.planName} প্ল্যান`;
  const subject =
    notice.kind === 'ENDING'
      ? en
        ? `${what} ends on ${notice.date}`
        : `${what} ${notice.date} তারিখে শেষ হবে`
      : en
        ? `${what} has ended`
        : `${what} শেষ হয়েছে`;
  const greeting = en ? `Hi ${notice.name},` : `প্রিয় ${notice.name},`;
  const body =
    notice.kind === 'ENDING'
      ? en
        ? `${what} ends on ${notice.date}. Renew before then to keep every feature.`
        : `${what} ${notice.date} তারিখে শেষ হবে। সব ফিচার রাখতে এর আগেই নবায়ন করুন।`
      : en
        ? `${what} ended on ${notice.date}, so your account is on the Free plan now. Your data is safe; choose a plan any time to get every feature back.`
        : `${what} ${notice.date} তারিখে শেষ হয়েছে, তাই আপনার অ্যাকাউন্ট এখন ফ্রি প্ল্যানে। আপনার ডেটা নিরাপদ আছে; যেকোনো সময় প্ল্যান নিয়ে সব ফিচার ফিরিয়ে আনুন।`;
  const action = en ? 'See plans' : 'প্ল্যান দেখুন';

  const text = `${greeting}\n\n${body}\n\n${action}: ${notice.link}\n\n- ${platformName}`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto;">
      <p style="color: #374151; font-size: 14px; line-height: 1.6;">${escapeHtml(greeting)}</p>
      <p style="color: #374151; font-size: 14px; line-height: 1.6;">${escapeHtml(body)}</p>
      <p style="margin-top: 24px;"><a href="${escapeHtml(notice.link)}" style="color: #1F7A5A; font-weight: 600;">${escapeHtml(action)}</a></p>
      <p style="color: #9ca3af; font-size: 12px; margin-top: 32px;">${escapeHtml(platformName)}</p>
    </div>
  `;
  return { subject, html, text };
}
