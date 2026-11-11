import { escapeHtml } from './escape-html.js';

export interface InvoiceEmail {
  name: string;
  invoiceNumber: string;
  planName: string;
  // Already formatted for the locale ("1,299" / "১,২৯৯").
  amount: string;
  // "2 Oct 2026" / "২ অক্টোবর ২০২৬".
  issuedOn: string;
  link: string;
}

// An admin sent the customer their invoice (Admin > Payments > Invoice >
// Email), in the customer's language. The PDF goes along as an attachment.
export function renderInvoiceEmail(locale: 'en' | 'bn', invoice: InvoiceEmail, platformName: string): { subject: string; html: string; text: string } {
  const en = locale === 'en';
  const subject = en ? `Your invoice ${invoice.invoiceNumber}` : `আপনার ইনভয়েস ${invoice.invoiceNumber}`;
  const greeting = en ? `Hi ${invoice.name},` : `প্রিয় ${invoice.name},`;
  const body = en
    ? `Your invoice ${invoice.invoiceNumber} for ${invoice.planName} (Tk ${invoice.amount}, issued ${invoice.issuedOn}) is attached as a PDF.`
    : `${invoice.planName}-এর ইনভয়েস ${invoice.invoiceNumber} (৳ ${invoice.amount}, ${invoice.issuedOn} তারিখে দেওয়া) PDF হিসেবে সংযুক্ত করা হলো।`;
  const keep = en ? 'Keep it for your records.' : 'আপনার রেকর্ডের জন্য রেখে দিন।';
  const action = en ? 'See your plan and payments' : 'আপনার প্ল্যান ও পেমেন্ট দেখুন';
  const signOff = en ? `Thank you, ${platformName}` : `ধন্যবাদ, ${platformName}`;

  const text = [greeting, '', `${body} ${keep}`, '', `${action}: ${invoice.link}`, '', `- ${platformName}`].join('\n');
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto;">
      <p style="color: #374151; font-size: 14px; line-height: 1.6;">${escapeHtml(greeting)}</p>
      <p style="color: #374151; font-size: 14px; line-height: 1.6;">${escapeHtml(body)} ${escapeHtml(keep)}</p>
      <p style="margin-top: 24px;"><a href="${escapeHtml(invoice.link)}" style="color: #1F7A5A; font-weight: 600;">${escapeHtml(action)}</a></p>
      <p style="color: #9ca3af; font-size: 12px; margin-top: 32px;">${escapeHtml(signOff)}</p>
    </div>
  `;
  return { subject, html, text };
}
