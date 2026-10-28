import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InvoicesService } from './invoices.service.js';

const rendered = (overrides: Record<string, unknown> = {}) => ({
  fileName: 'INV-2026-000001.pdf',
  data: Buffer.from('%PDF-1.4'),
  invoice: {
    id: 'inv-1',
    invoiceNumber: 'INV-2026-000001',
    paymentId: 'pay-1',
    totalAmount: '1299.00',
    createdAt: new Date('2026-10-01T19:00:00.000Z'),
    planName: 'Yearly Pro',
    userId: 'u-1' as string | null,
    platformUserId: null as string | null,
    ...overrides,
  },
});

const setup = ({
  configured = true,
  pdf = rendered(),
  user = { name: 'Nadia', email: 'nadia@example.com', preferredLanguage: 'BN', status: 'ACTIVE' } as object | null,
} = {}) => {
  const prisma = {
    user: { findUnique: vi.fn().mockResolvedValue(user) },
    platformUser: { findUnique: vi.fn().mockResolvedValue({ name: 'Old', email: 'old@example.com' }) },
    invoice: { update: vi.fn((args: unknown) => args) },
    auditLog: { create: vi.fn((args: unknown) => args) },
    $transaction: vi.fn().mockResolvedValue([]),
  };
  const invoicePdf = { render: vi.fn().mockResolvedValue(pdf) };
  const mail = { configured, sendInvoiceEmail: vi.fn().mockResolvedValue(undefined) };
  const config = { get: vi.fn().mockReturnValue('https://app.example.com') };
  return { service: new InvoicesService(prisma as never, invoicePdf as never, mail as never, config as never), prisma, invoicePdf, mail };
};

describe('InvoicesService.email', () => {
  it('sends the PDF to the customer in their language, then marks it emailed and audits it', async () => {
    const { service, prisma, mail } = setup();

    const result = await service.email('inv-1', 'admin-1', '10.0.0.1');

    expect(mail.sendInvoiceEmail).toHaveBeenCalledWith(
      'nadia@example.com',
      'bn',
      {
        name: 'Nadia',
        invoiceNumber: 'INV-2026-000001',
        planName: 'Yearly Pro',
        amount: '১,২৯৯',
        issuedOn: '২ অক্টোবর ২০২৬',
        link: 'https://app.example.com/settings/plans',
      },
      [{ filename: 'INV-2026-000001.pdf', content: Buffer.from('%PDF-1.4') }],
    );
    expect(result).toEqual({ success: true, sentTo: 'nadia@example.com', emailedAt: expect.any(Date) });
    expect(prisma.invoice.update).toHaveBeenCalledWith({ where: { id: 'inv-1' }, data: { emailedAt: result.emailedAt } });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        adminUserId: 'admin-1',
        action: 'INVOICE_EMAILED',
        entityType: 'Invoice',
        entityId: 'inv-1',
        newValue: { invoiceNumber: 'INV-2026-000001', sentTo: 'nadia@example.com', paymentId: 'pay-1' },
        ipAddress: '10.0.0.1',
      },
    });
  });

  it('answers 503 EMAIL_NOT_CONFIGURED without email, before reading anything', async () => {
    const { service, invoicePdf } = setup({ configured: false });
    const error = await service.email('inv-1', 'admin-1').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getResponse()).toMatchObject({ reason: 'EMAIL_NOT_CONFIGURED' });
    expect(invoicePdf.render).not.toHaveBeenCalled();
  });

  it("goes to a legacy payment's PlatformUser, and is a 400 when nobody has an address", async () => {
    const legacy = setup({ pdf: rendered({ userId: null, platformUserId: 'legacy-1' }) });
    await expect(legacy.service.email('inv-1', 'admin-1')).resolves.toMatchObject({ sentTo: 'old@example.com' });

    const nobody = setup({ pdf: rendered({ userId: null, platformUserId: null }) });
    await expect(nobody.service.email('inv-1', 'admin-1')).rejects.toBeInstanceOf(BadRequestException);

    const deleted = setup({ user: { name: 'Gone', email: 'gone@example.com', preferredLanguage: 'EN', status: 'DELETED' } });
    await expect(deleted.service.email('inv-1', 'admin-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(deleted.mail.sendInvoiceEmail).not.toHaveBeenCalled();
  });

  it('answers 503 EMAIL_NOT_SENT when the send fails, without marking it emailed', async () => {
    const { service, mail, prisma } = setup();
    mail.sendInvoiceEmail.mockRejectedValue(new Error('Resend down'));
    const error = await service.email('inv-1', 'admin-1').catch((caught: unknown) => caught);
    expect((error as ServiceUnavailableException).getResponse()).toMatchObject({ reason: 'EMAIL_NOT_SENT' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('passes the 404 for a missing invoice through', async () => {
    const { service, invoicePdf } = setup();
    invoicePdf.render.mockRejectedValue(new NotFoundException('Invoice not found'));
    await expect(service.email('missing', 'admin-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
