import { escapeHtml } from './escape-html.js';

export interface ReceiptEmail {
  name: string;
  planName: string;
  // Already formatted for the locale ("1,299" / "১,২৯৯").
  amount: string;
  invoiceNumber: string;
  // "27 Nov 2026", or null for a plan with no end.
  paidUntil: string | null;
  link: string;
}

// Sent when a customer's payment is confirmed (an admin's Mark paid, or a
// gateway's webhook), in their language.
export function renderBillingReceiptEmail(locale: 'en' | 'bn', receipt: ReceiptEmail, platformName: string): { subject: string; html: string; text: string } {
  const en = locale === 'en';
  const subject = en ? `Payment received: ${receipt.invoiceNumber}` : `পেমেন্ট পেয়েছি: ${receipt.invoiceNumber}`;
  const greeting = en ? `Hi ${receipt.name},` : `প্রিয় ${receipt.name},`;
  const body = en
    ? `We received your payment of ৳ ${receipt.amount} for ${receipt.planName}.`
    : `${receipt.planName}-এর জন্য আপনার ৳ ${receipt.amount} পেমেন্ট আমরা পেয়েছি।`;
  const until = receipt.paidUntil ? (en ? `Your plan runs until ${receipt.paidUntil}.` : `আপনার প্ল্যান ${receipt.paidUntil} পর্যন্ত চলবে।`) : '';
  const invoice = en ? `Invoice: ${receipt.invoiceNumber}` : `ইনভয়েস: ${receipt.invoiceNumber}`;
  const action = en ? 'See your plan and payments' : 'আপনার প্ল্যান ও পেমেন্ট দেখুন';
  const signOff = en ? `Thank you, ${platformName}` : `ধন্যবাদ, ${platformName}`;

  const text = [greeting, '', until ? `${body} ${until}` : body, invoice, '', `${action}: ${receipt.link}`, '', `- ${platformName}`].join('\n');
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto;">
      <p style="color: #374151; font-size: 14px; line-height: 1.6;">${escapeHtml(greeting)}</p>
      <p style="color: #374151; font-size: 14px; line-height: 1.6;">${escapeHtml(body)}${until ? ` ${escapeHtml(until)}` : ''}</p>
      <p style="color: #111827; font-size: 14px; line-height: 1.6;"><b>${escapeHtml(invoice)}</b></p>
      <p style="margin-top: 24px;"><a href="${escapeHtml(receipt.link)}" style="color: #1F7A5A; font-weight: 600;">${escapeHtml(action)}</a></p>
      <p style="color: #9ca3af; font-size: 12px; margin-top: 32px;">${escapeHtml(signOff)}</p>
    </div>
  `;
  return { subject, html, text };
}
