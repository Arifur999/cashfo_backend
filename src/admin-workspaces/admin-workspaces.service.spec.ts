import { AdminWorkspacesService } from './admin-workspaces.service.js';

const plan = (name: string, price: number, billingCycle = 'MONTHLY') => ({ name, price, billingCycle });
const business = (name: string, overrides: Partial<{ isDefault: boolean; type: string; plan: ReturnType<typeof plan> | null }> = {}) => ({
  name,
  isDefault: false,
  type: 'BUSINESS',
  plan: null,
  ...overrides,
});

// Four owners with extra workspaces, in the order the database would hand
// them back (by nothing in particular).
const OWNERS = [
  {
    id: 'u-free',
    name: 'Kamrul Islam',
    email: 'kamrul@example.com',
    ownedBusinesses: [business('Personal', { isDefault: true, type: 'PERSONAL', plan: plan('Free', 0) }), business('Islam Store')],
  },
  {
    id: 'u-yearly',
    name: 'Rezaul Karim',
    email: 'rezaul@example.com',
    ownedBusinesses: [
      business('Personal', { isDefault: true, type: 'PERSONAL', plan: plan('Yearly Pro', 2999, 'YEARLY') }),
      business('Karim Family'),
    ],
  },
  {
    id: 'u-business',
    name: 'Tanzila Haque',
    email: 'tanzila@example.com',
    ownedBusinesses: [
      business('Personal', { isDefault: true, type: 'PERSONAL', plan: plan('Business', 799) }),
      business('Haque & Sons'),
      business('Haque Agro'),
      business('Haque Family', { type: 'GROUP' }),
    ],
  },
  {
    id: 'u-monthly',
    name: 'Mahbub Alam',
    email: 'mahbub@example.com',
    ownedBusinesses: [business('Personal', { isDefault: true, type: 'PERSONAL', plan: plan('Monthly Pro', 299) }), business('Alam Traders')],
  },
];

const setup = () => {
  const prisma = {
    user: { findMany: vi.fn().mockResolvedValue(OWNERS), count: vi.fn().mockResolvedValue(1272) },
  };
  return { service: new AdminWorkspacesService(prisma as never), prisma };
};

describe('AdminWorkspacesService.overview', () => {
  it('lists the biggest estimated add-on first and names every workspace', async () => {
    const { service } = setup();
    const result = await service.overview({});

    expect(result.items.map((item) => item.userId)).toEqual(['u-business', 'u-monthly', 'u-yearly', 'u-free']);
    expect(result.items[0]).toMatchObject({
      workspaceNames: ['Personal', 'Haque & Sons', 'Haque Agro', 'Haque Family'],
      planName: 'Business',
      totalWorkspaces: 4,
      additionalWorkspaces: 3,
      // Two business add-ons at half of 799; the group workspace is free.
      estimatedMonthlyAddOnRevenue: '799.00',
    });
  });

  it('charges a yearly plan by its monthly share and the Free plan nothing', async () => {
    const { service } = setup();
    const { items } = await service.overview({});

    expect(items.find((item) => item.userId === 'u-yearly')?.estimatedMonthlyAddOnRevenue).toBe('124.96');
    expect(items.find((item) => item.userId === 'u-free')?.estimatedMonthlyAddOnRevenue).toBe('0.00');
  });

  it('sums every owner into the summary and counts how many workspaces they have', async () => {
    const { service } = setup();
    const { summary } = await service.overview({});

    expect(summary).toEqual({
      totalUsers: 4,
      totalAccounts: 1272,
      totalAdditionalWorkspaces: 6,
      totalEstimatedMonthlyAddOnRevenue: '1073.46',
      spread: [
        { workspaces: 2, users: 3 },
        { workspaces: 4, users: 1 },
      ],
    });
  });

  it('pages the sorted list in memory, with the total of the whole set', async () => {
    const { service } = setup();
    const result = await service.overview({ page: 2, limit: 3 });

    expect(result.items.map((item) => item.userId)).toEqual(['u-free']);
    expect(result).toMatchObject({ page: 2, limit: 3, totalCount: 4 });
  });
});
