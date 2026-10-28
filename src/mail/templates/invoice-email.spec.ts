import { renderInvoiceEmail } from './invoice-email.js';

const invoice = {
  name: 'Nadia <b>',
  invoiceNumber: 'INV-2026-000001',
  planName: 'Yearly Pro',
  amount: '1,299',
  issuedOn: '2 Oct 2026',
  link: 'https://app.example.com/settings/plans',
};

describe('renderInvoiceEmail', () => {
  it('names the invoice in English and escapes what the customer typed', () => {
    const email = renderInvoiceEmail('en', invoice, 'Smartly');
    expect(email.subject).toBe('Your invoice INV-2026-000001');
    expect(email.text).toContain('Your invoice INV-2026-000001 for Yearly Pro (৳ 1,299, issued 2 Oct 2026) is attached as a PDF.');
    expect(email.text).toContain('https://app.example.com/settings/plans');
    expect(email.html).toContain('Nadia &lt;b&gt;');
    expect(email.html).not.toContain('Nadia <b>');
  });

  it('has a Bangla version', () => {
    const email = renderInvoiceEmail('bn', { ...invoice, amount: '১,২৯৯' }, 'Smartly');
    expect(email.subject).toBe('আপনার ইনভয়েস INV-2026-000001');
    expect(email.text).toContain('৳ ১,২৯৯');
    expect(email.html).toContain('ধন্যবাদ, Smartly');
  });
});
