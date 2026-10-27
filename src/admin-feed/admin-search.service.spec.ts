import { AdminSearchService, searchKindsFor } from './admin-search.service.js';

describe('searchKindsFor', () => {
  it('gives each role the kinds its pages show', () => {
    expect([...searchKindsFor('SUPER_ADMIN')]).toEqual(['people', 'payments', 'tickets']);
    expect([...searchKindsFor('FINANCE_ADMIN')]).toEqual(['people', 'payments']);
    expect([...searchKindsFor('SUPPORT_ADMIN')]).toEqual(['people', 'tickets']);
    expect([...searchKindsFor('CONTENT_ADMIN')]).toEqual(['people']);
  });
});

describe('AdminSearchService.search', () => {
  const setup = () => {
    const prisma = {
      user: { findMany: vi.fn().mockResolvedValue([{ id: 'u1', name: 'Sharmin', email: 's@example.com', status: 'ACTIVE', ownedBusinesses: [] }]) },
      payment: { findMany: vi.fn().mockResolvedValue([]) },
      supportTicket: { findMany: vi.fn().mockResolvedValue([]) },
      platformUser: { findMany: vi.fn().mockResolvedValue([]) },
    };
    // requesterNames reads User for the names too.
    return { service: new AdminSearchService(prisma as never), prisma };
  };

  it("doesn't look up payments for support or tickets for finance", async () => {
    const support = setup();
    await support.service.search('sharmin', 'SUPPORT_ADMIN');
    expect(support.prisma.payment.findMany).not.toHaveBeenCalled();
    expect(support.prisma.supportTicket.findMany).toHaveBeenCalled();

    const finance = setup();
    const result = await finance.service.search('sharmin', 'FINANCE_ADMIN');
    expect(finance.prisma.supportTicket.findMany).not.toHaveBeenCalled();
    expect(result.tickets).toEqual([]);

    const content = setup();
    const only = await content.service.search('sharmin', 'CONTENT_ADMIN');
    expect(only.people).toHaveLength(1);
    expect(content.prisma.payment.findMany).not.toHaveBeenCalled();
    expect(content.prisma.supportTicket.findMany).not.toHaveBeenCalled();
  });
});
