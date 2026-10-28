import { dhakaDateTime, paymentExportRow, paymentsExportFileName, PAYMENT_EXPORT_HEADERS, type ExportPayment } from './payments-export.js';

const payment = (overrides: Partial<ExportPayment> = {}): ExportPayment => ({
  id: '3f2a1c9b-0000-4000-8000-000000000000',
  userId: 'u-1',
  platformUserId: null,
  // 10:14 on 1 Oct in Dhaka.
  createdAt: new Date('2026-10-01T04:14:00.000Z'),
  purpose: 'NEW',
  gateway: 'BKASH',
  status: 'SUCCESS',
  listPrice: '399.00',
  discountApplied: '100.00',
  amount: '299.00',
  gatewayReferenceId: 'BKA8X2Q71D',
  paidAt: new Date('2026-10-01T18:30:00.000Z'),
  plan: { name: 'Monthly Pro' },
  invoice: { invoiceNumber: 'INV-2026-000403' },
  refund: null,
  ...overrides,
});

describe('payments export rows', () => {
  it('has a cell for every header, in order', () => {
    const row = paymentExportRow(payment(), { id: 'u-1', name: 'Mahbub Alam', email: 'mahbub@example.com' });
    expect(row).toHaveLength(PAYMENT_EXPORT_HEADERS.length);
    expect(row).toEqual([
      'PAY-3F2A1C9B',
      '2026-10-01 10:14',
      'Mahbub Alam',
      'mahbub@example.com',
      'Monthly Pro',
      'NEW',
      'BKASH',
      '399.00',
      '100.00',
      '299.00',
      'SUCCESS',
      'BKA8X2Q71D',
      // Past Dhaka midnight: the next day.
      '2026-10-02 00:30',
      'INV-2026-000403',
      '',
    ]);
  });

  it('works the discount out for an older row and fills only a completed refund', () => {
    const older = paymentExportRow(payment({ discountApplied: null, refund: { amount: '50.00', status: 'COMPLETED' } }), null);
    expect(older[8]).toBe('100.00');
    expect(older[14]).toBe('50.00');
    expect(older[2]).toBe('');
    expect(paymentExportRow(payment({ refund: { amount: '50.00', status: 'PENDING' } }), null)[14]).toBe('');
    expect(paymentExportRow(payment({ listPrice: null, discountApplied: null }), null)[8]).toBe('');
  });

  it('leaves blank what a payment does not have yet', () => {
    const row = paymentExportRow(payment({ status: 'PENDING', paidAt: null, gatewayReferenceId: null, invoice: null }), null);
    expect([row[11], row[12], row[13]]).toEqual(['', '', '']);
  });

  it('prints Dhaka dates and names the file by the Dhaka day', () => {
    expect(dhakaDateTime(null)).toBe('');
    expect(dhakaDateTime(new Date('2026-12-31T18:00:00.000Z'))).toBe('2027-01-01 00:00');
    expect(paymentsExportFileName(new Date('2026-10-27T19:00:00.000Z'))).toBe('payments-2026-10-28.csv');
  });
});
