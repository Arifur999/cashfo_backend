import { billedTo, fitSize, invoiceFileName, invoiceMoney, invoiceView, renderInvoicePdf, storedLines, type InvoicePdfInput } from './invoice-pdf-layout.js';

const input = (overrides: { payment?: Partial<InvoicePdfInput['payment']>; invoice?: Partial<InvoicePdfInput['invoice']> } = {}): InvoicePdfInput => ({
  platformName: 'Money Tracker',
  supportEmail: 'billing@example.com',
  invoice: {
    invoiceNumber: 'INV-2026-000412',
    issuedTo: 'Nusrat Jahan <nusrat.jahan@example.com>',
    lineItems: [
      { description: 'Business subscription', amount: 899 },
      { description: 'Coupon PRO100', amount: -100 },
    ],
    totalAmount: '799.00',
    // 2 Oct 2026 in Dhaka (late on 1 Oct in UTC).
    createdAt: new Date('2026-10-01T19:00:00.000Z'),
    ...overrides.invoice,
  },
  payment: {
    id: '3f2a1c9b-0000-4000-8000-000000000000',
    status: 'SUCCESS',
    gateway: 'BKASH',
    currency: 'BDT',
    gatewayReferenceId: 'BKA8X2Q71D',
    payerAccount: '01819-552310',
    paidAt: new Date('2026-10-01T19:05:00.000Z'),
    periodStart: new Date('2026-10-01T19:05:00.000Z'),
    periodEnd: new Date('2026-11-01T19:05:00.000Z'),
    refund: null,
    ...overrides.payment,
  },
});

describe('invoiceView', () => {
  it('words the invoice like the board: number, Dhaka date, lines, sums and payment', () => {
    const view = invoiceView(input());
    expect(view).toMatchObject({
      platformName: 'Money Tracker',
      contactLine: 'Dhaka, Bangladesh · billing@example.com',
      invoiceNumber: 'INV-2026-000412',
      stamp: 'PAID',
      issueDate: '2 Oct 2026',
      billedTo: { name: 'Nusrat Jahan', email: 'nusrat.jahan@example.com' },
      subtotal: 'TK 899.00',
      discount: 'TK 100.00',
      total: 'TK 799.00',
      totalLabel: 'Total paid',
      payment: { displayId: 'PAY-3F2A1C9B', method: 'bKash', reference: 'BKA8X2Q71D', payerAccount: '01819-552310', paidOn: '2 Oct 2026' },
      refund: null,
    });
    expect(view.lines).toEqual([
      { description: 'Business subscription', period: '2 Oct 2026 - 2 Nov 2026', amount: 'TK 899.00' },
      { description: 'Coupon PRO100', period: '', amount: '- TK 100.00' },
    ]);
    expect(view.footer[0]).toBe('Thank you for using Money Tracker. Questions about this invoice? Reply from the Help page in the app.');
  });

  it('stamps a full refund REFUNDED and a partial one PARTLY REFUNDED, with the refund line', () => {
    const refunded = (amount: string) =>
      invoiceView(input({ payment: { status: 'REFUNDED', refund: { amount, status: 'COMPLETED', createdAt: new Date('2026-10-05T06:00:00.000Z') } } }));
    expect(refunded('799.00')).toMatchObject({ stamp: 'REFUNDED', refund: { amount: 'TK 799.00', date: '5 Oct 2026' } });
    expect(refunded('50.00')).toMatchObject({ stamp: 'PARTLY REFUNDED', refund: { amount: 'TK 50.00' } });
  });

  it('leaves out a refund that has not gone through, and marks an unpaid one', () => {
    const pending = invoiceView(input({ payment: { refund: { amount: '10', status: 'PENDING', createdAt: new Date() } } }));
    expect(pending.refund).toBeNull();
    expect(invoiceView(input({ payment: { status: 'PENDING', paidAt: null } }))).toMatchObject({
      stamp: 'UNPAID',
      totalLabel: 'Total due',
      payment: { paidOn: null },
    });
  });

  it('falls back to the email for a name the fonts cannot show, and to the product name', () => {
    const view = invoiceView({ ...input({ invoice: { issuedTo: 'নুসরাত জাহান <nusrat@example.com>' } }), platformName: 'স্মার্টলি', supportEmail: null });
    expect(view.billedTo).toEqual({ name: null, email: 'nusrat@example.com', phone: null });
    expect(view.platformName).toBe('Smartly');
    expect(view.contactLine).toBe('Dhaka, Bangladesh');
  });

  it('prints the billing phone under the name, when the invoice has one', () => {
    const view = invoiceView(input({ invoice: { issuedTo: 'Akter Traders <accounts@akter.example>', issuedPhone: '+8801811000000' } }));
    expect(view.billedTo).toEqual({ name: 'Akter Traders', email: 'accounts@akter.example', phone: '+8801811000000' });
  });

  it('has no period without one and a zero discount without a discount line', () => {
    const view = invoiceView(
      input({ invoice: { lineItems: [{ description: 'Monthly Pro subscription', amount: 299 }], totalAmount: '299.00' }, payment: { periodStart: null } }),
    );
    expect(view.lines).toEqual([{ description: 'Monthly Pro subscription', period: '', amount: 'TK 299.00' }]);
    expect(view.discount).toBe('TK 0.00');
  });
});

describe('invoice helpers', () => {
  it('prints money with lakh grouping and the paisa', () => {
    expect(invoiceMoney(125000000)).toBe('TK 12,50,000.00');
    expect(invoiceMoney(269910)).toBe('TK 2,699.10');
    expect(invoiceMoney(-10000)).toBe('- TK 100.00');
    expect(invoiceMoney(500, 'USD')).toBe('USD 5.00');
  });

  it('splits the issuedTo snapshot', () => {
    expect(billedTo('Mahbub Alam <mahbub@example.com>')).toEqual({ name: 'Mahbub Alam', email: 'mahbub@example.com' });
    expect(billedTo('Unknown customer')).toEqual({ name: 'Unknown customer', email: null });
  });

  it('reads the stored line items, skipping anything malformed', () => {
    expect(storedLines([{ description: 'A', amount: 10 }, null, { amount: 'x' }, { amount: 5 }])).toEqual([
      { description: 'A', paisa: 1000 },
      { description: 'Item', paisa: 500 },
    ]);
    expect(storedLines('nope')).toEqual([]);
  });

  it('names the file after the invoice number', () => {
    expect(invoiceFileName('INV-2026-000001')).toBe('INV-2026-000001.pdf');
    expect(invoiceFileName('../x"y')).toBe('xy.pdf');
  });
});

describe('renderInvoicePdf', () => {
  it('makes a PDF that carries the invoice text', () => {
    const pdf = renderInvoicePdf(invoiceView(input()));
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.endsWith('%%EOF\n')).toBe(true);
    for (const words of ['(INVOICE)', '(INV-2026-000412)', '(PAID)', '(Nusrat Jahan)', '(TK 799.00)', '(Total paid)', '(BKA8X2Q71D)']) {
      expect(text).toContain(words);
    }
    expect(text).toContain('/Title (Invoice INV-2026-000412)');
  });

  it('runs a long list of items onto another page', () => {
    const lineItems = Array.from({ length: 60 }, (_, index) => ({ description: `Item ${index + 1}`, amount: 1 }));
    const text = renderInvoicePdf(invoiceView(input({ invoice: { lineItems } }))).toString('latin1');
    expect(Number(/\/Count (\d+)/.exec(text)?.[1])).toBeGreaterThan(1);
  });
});

describe('fitSize', () => {
  it('keeps the size when the text fits and shrinks it, not below 7pt, when not', () => {
    expect(fitSize('Nadia', 'bold', 11, 200)).toBe(11);
    const shrunk = fitSize('delivered+smoke7c-1793124893777@resend.dev', 'bold', 11, 200);
    expect(shrunk).toBeLessThan(11);
    expect(shrunk).toBeGreaterThanOrEqual(7);
    expect(fitSize('x'.repeat(500), 'regular', 10, 50)).toBe(7);
  });
});
