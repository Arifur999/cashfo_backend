import { PaymentConfirmationService } from './payment-confirmation.service.js';

// Mark paid's receipt: it carries the invoice PDF, and the invoice is
// marked emailed only when the receipt went.
const plan = { id: 'monthly', name: 'Monthly Pro', price: '299.00', billingCycle: 'MONTHLY' };
const row = {
  id: 'pay-1',
  userId: 'u-nadia',
  platformUserId: null,
  planId: 'monthly',
  amount: '299.00',
  listPrice: '299.00',
  couponId: null,
  plan,
  invoice: null,
};

const setup = ({ emailed = true, pdfFails = false } = {}) => {
  const tx = {
    payment: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue(row),
      update: vi.fn().mockResolvedValue({}),
    },
    user: { findUnique: vi.fn().mockResolvedValue({ name: 'Nadia', email: 'nadia@example.com' }) },
    invoice: {
      create: vi.fn((args: { data: Record<string, unknown> }) => Promise.resolve({ id: 'inv-1', emailedAt: null, ...args.data })),
      count: vi.fn().mockResolvedValue(0),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    $executeRaw: vi.fn().mockResolvedValue(0),
  };
  const prisma = {
    $transaction: vi.fn((run: (client: typeof tx) => Promise<unknown>) => run(tx)),
    invoice: { update: vi.fn().mockResolvedValue({}) },
  };
  const subscriptions = { activateFromPayment: vi.fn().mockResolvedValue({ subscription: null, periodStart: null, periodEnd: null }) };
  const hooks = { runPaid: vi.fn().mockResolvedValue([]), afterCommit: vi.fn() };
  // Calls the attachment loader the way BillingNotices does before sending.
  const attachments: unknown[] = [];
  const notices = {
    paid: vi.fn(async (_payment: unknown, _plan: string, _number: string, attachment?: () => Promise<unknown>) => {
      attachments.push(attachment ? await attachment() : undefined);
      return emailed;
    }),
  };
  const settings = { getCached: vi.fn() };
  const invoicePdf = {
    render: pdfFails
      ? vi.fn().mockRejectedValue(new Error('boom'))
      : vi.fn().mockResolvedValue({ fileName: 'INV-2026-000001.pdf', data: Buffer.from('%PDF-1.4') }),
  };
  const service = new PaymentConfirmationService(
    prisma as never,
    subscriptions as never,
    hooks as never,
    notices as never,
    settings as never,
    invoicePdf as never,
  );
  return { service, prisma, invoicePdf, attachments };
};

describe('PaymentConfirmationService.markPaid receipt', () => {
  it('attaches the invoice PDF and marks the invoice emailed', async () => {
    const { service, prisma, invoicePdf, attachments } = setup();

    const result = await service.markPaid('pay-1', { reference: 'TRX1' }, { adminId: 'admin-1' });

    expect(invoicePdf.render).toHaveBeenCalledWith('inv-1');
    expect(attachments).toEqual([{ filename: 'INV-2026-000001.pdf', content: Buffer.from('%PDF-1.4') }]);
    expect(prisma.invoice.update).toHaveBeenCalledWith({ where: { id: 'inv-1' }, data: { emailedAt: expect.any(Date) } });
    expect(result.invoice.emailedAt).toBeInstanceOf(Date);
  });

  it('leaves emailedAt alone when no receipt went', async () => {
    const { service, prisma } = setup({ emailed: false });
    const result = await service.markPaid('pay-1', { reference: 'TRX1' }, { adminId: 'admin-1' });
    expect(prisma.invoice.update).not.toHaveBeenCalled();
    expect(result.invoice.emailedAt).toBeNull();
  });

  it('still sends the receipt, without the PDF, when the PDF cannot be made', async () => {
    const { service, attachments } = setup({ pdfFails: true });
    await expect(service.markPaid('pay-1', { reference: 'TRX1' }, { adminId: 'admin-1' })).resolves.toBeDefined();
    expect(attachments).toEqual([null]);
  });

  it('never fails Mark paid when stamping the invoice fails', async () => {
    const { service, prisma } = setup();
    prisma.invoice.update.mockRejectedValue(new Error('db hiccup'));
    const result = await service.markPaid('pay-1', { reference: 'TRX1' }, { adminId: 'admin-1' });
    expect(result.invoice.emailedAt).toBeNull();
  });
});
