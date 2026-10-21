import { NotFoundException } from '@nestjs/common';
import { InvoicesService } from './invoices.service.js';

type InvoiceQuery = { where: { id: string }; include: { payment: Record<string, unknown> } };

const invoice = (refund: object | null) => ({
  id: 'inv-1',
  paymentId: 'pay-1',
  invoiceNumber: 'INV-2026-000123',
  issuedTo: 'Mahbub Alam <mahbub@example.com>',
  lineItems: [{ description: 'Monthly Pro subscription', amount: 299 }],
  totalAmount: '299.00',
  pdfUrl: null,
  createdAt: new Date('2026-10-01T04:12:00.000Z'),
  payment: {
    id: 'pay-1',
    platformUserId: 'mahbub',
    planId: 'monthly',
    amount: '299.00',
    currency: 'BDT',
    gateway: 'BKASH',
    status: refund ? 'REFUNDED' : 'SUCCESS',
    plan: { id: 'monthly', name: 'Monthly Pro' },
    refund,
  },
});

// The one invoice there is, found by its id.
const setup = (stored: ReturnType<typeof invoice>) => {
  const prisma = { invoice: { findUnique: vi.fn(({ where }: InvoiceQuery) => Promise.resolve(where.id === stored.id ? stored : null)) } };
  return { service: new InvoicesService(prisma as never), prisma };
};

describe('InvoicesService.getById', () => {
  it("reads the payment's refund in the same query, enough to stamp a partial refund", async () => {
    const { service, prisma } = setup(invoice({ amount: '50.00', status: 'COMPLETED', createdAt: new Date('2026-10-03T09:10:00.000Z') }));

    const result = await service.getById('inv-1');

    expect(prisma.invoice.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.invoice.findUnique).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
      include: {
        payment: {
          include: {
            plan: { select: { id: true, name: true } },
            refund: { select: { amount: true, status: true, createdAt: true } },
          },
        },
      },
    });
    expect(result.payment).toMatchObject({ status: 'REFUNDED', refund: { amount: '50.00', status: 'COMPLETED' } });
  });

  it('includes the whole payment rather than picking columns, so its status and currency stay in the answer', async () => {
    const { service, prisma } = setup(invoice(null));

    const result = await service.getById('inv-1');

    expect(prisma.invoice.findUnique.mock.calls[0][0].include.payment).not.toHaveProperty('select');
    expect(result.payment).toMatchObject({ status: 'SUCCESS', currency: 'BDT', gateway: 'BKASH', refund: null });
  });

  it('says so when there is no such invoice', async () => {
    const { service } = setup(invoice(null));
    await expect(service.getById('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
