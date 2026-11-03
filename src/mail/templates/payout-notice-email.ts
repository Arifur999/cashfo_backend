import { escapeHtml } from './escape-html.js';

export interface PayoutNotice {
  // PAID: the money was sent; REJECTED: the request was turned down and the
  // money is back in the referral balance.
  kind: 'PAID' | 'REJECTED';
  name: string;
  // "WD-1048"
  displayId: string;
  // Already formatted for the locale ("1,000" / "১,০০০").
  amount: string;
  // "bKash 01711-•••915", "BRAC Bank •••• 2201"
  destination: string;
  // PAID: the transaction id; REJECTED: null.
  trxId: string | null;
  // REJECTED: the admin's reason.
  reason: string | null;
  // PAID: the amount was added as income to this wallet.
  incomeWallet: string | null;
  link: string;
}

// Sent when a referral withdrawal is paid or rejected, in the member's
// language.
export function renderPayoutNoticeEmail(locale: 'en' | 'bn', notice: PayoutNotice, platformName: string): { subject: string; html: string; text: string } {
  const en = locale === 'en';
  const paid = notice.kind === 'PAID';
  const subject = paid
    ? en
      ? `Your withdrawal ${notice.displayId} is paid`
      : `আপনার টাকা তোলার অনুরোধ ${notice.displayId} পরিশোধিত`
    : en
      ? `Your withdrawal ${notice.displayId} was not approved`
      : `আপনার টাকা তোলার অনুরোধ ${notice.displayId} বাতিল হয়েছে`;
  const greeting = en ? `Hi ${notice.name},` : `প্রিয় ${notice.name},`;
  const lines: string[] = [];
  if (paid) {
    lines.push(en ? `We sent TK ${notice.amount} to ${notice.destination}.` : `আমরা ${notice.destination}-এ ৳ ${notice.amount} পাঠিয়েছি।`);
    if (notice.trxId) lines.push(en ? `Transaction ID: ${notice.trxId}` : `ট্রানজেকশন আইডি: ${notice.trxId}`);
    if (notice.incomeWallet) {
      lines.push(
        en
          ? `It was added as Referral income to your ${notice.incomeWallet} wallet.`
          : `এটি আপনার ${notice.incomeWallet} ওয়ালেটে রেফারেল আয় হিসেবে যোগ হয়েছে।`,
      );
    }
  } else {
    lines.push(
      en
        ? `We couldn't pay your request for TK ${notice.amount} to ${notice.destination}.`
        : `${notice.destination}-এ ৳ ${notice.amount} পাঠানোর অনুরোধটি আমরা পরিশোধ করতে পারিনি।`,
    );
    if (notice.reason) lines.push(en ? `Reason: ${notice.reason}` : `কারণ: ${notice.reason}`);
    lines.push(
      en ? 'The money is back in your referral balance, so you can ask again.' : 'টাকাটি আপনার রেফারেল ব্যালেন্সে ফিরে গেছে, আবার অনুরোধ করতে পারবেন।',
    );
  }
  const action = en ? 'See your withdrawals' : 'আপনার টাকা তোলার তালিকা দেখুন';

  const text = [greeting, '', ...lines, '', `${action}: ${notice.link}`, '', `- ${platformName}`].join('\n');
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto;">
      <p style="color: #374151; font-size: 14px; line-height: 1.6;">${escapeHtml(greeting)}</p>
      ${lines.map((line) => `<p style="color: #374151; font-size: 14px; line-height: 1.6;">${escapeHtml(line)}</p>`).join('\n      ')}
      <p style="margin-top: 24px;"><a href="${escapeHtml(notice.link)}" style="color: #1F7A5A; font-weight: 600;">${escapeHtml(action)}</a></p>
      <p style="color: #9ca3af; font-size: 12px; margin-top: 32px;">${escapeHtml(platformName)}</p>
    </div>
  `;
  return { subject, html, text };
}
