import { AdminWorkspacesService } from './admin-workspaces.service.js';

const plan = (name: string, price: number, billingCycle = 'MONTHLY') => ({ name, price, billingCycle });
const business = (name: string, overrides: Partial<{ id: string; isDefault: boolean; type: string; plan: ReturnType<typeof plan> | null }> = {}) => ({
  id: `id-${name}`,
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

  it('orders by the ?sort= the list picks, ties falling back to the biggest add-on', async () => {
    const { service } = setup();
    const order = async (sort: 'addOn' | 'workspaces' | 'extra' | 'name' | 'plan') =>
      (await service.overview({ sort })).items.map((item) => item.userId);

    expect(await order('addOn')).toEqual(['u-business', 'u-monthly', 'u-yearly', 'u-free']);
    expect(await order('workspaces')).toEqual(['u-business', 'u-monthly', 'u-yearly', 'u-free']);
    expect(await order('extra')).toEqual(['u-business', 'u-monthly', 'u-yearly', 'u-free']);
    expect(await order('name')).toEqual(['u-free', 'u-monthly', 'u-yearly', 'u-business']);
    expect(await order('plan')).toEqual(['u-business', 'u-free', 'u-monthly', 'u-yearly']);
  });

  it('puts an owner without a plan after every plan, and sorts before it pages', async () => {
    const { service, prisma } = setup();
    prisma.user.findMany.mockResolvedValue([
      ...OWNERS,
      { id: 'u-none', name: 'Aminul Haq', email: 'aminul@example.com', ownedBusinesses: [business('Personal', { isDefault: true, type: 'PERSONAL' }), business('Haq Shop')] },
    ]);

    expect((await service.overview({ sort: 'plan' })).items.at(-1)?.userId).toBe('u-none');
    expect((await service.overview({ sort: 'name', page: 1, limit: 1 })).items.map((item) => item.userId)).toEqual(['u-none']);
  });

  it('gives every workspace its id and kind beside the names, oldest first', async () => {
    const { service } = setup();
    const { items } = await service.overview({});
    const tanzila = items.find((item) => item.userId === 'u-business');

    expect(tanzila?.workspaces).toEqual([
      { id: 'id-Personal', name: 'Personal', type: 'PERSONAL', isDefault: true },
      { id: 'id-Haque & Sons', name: 'Haque & Sons', type: 'BUSINESS', isDefault: false },
      { id: 'id-Haque Agro', name: 'Haque Agro', type: 'BUSINESS', isDefault: false },
      { id: 'id-Haque Family', name: 'Haque Family', type: 'GROUP', isDefault: false },
    ]);
    // workspaceNames stays as it was.
    expect(tanzila?.workspaceNames).toEqual(['Personal', 'Haque & Sons', 'Haque Agro', 'Haque Family']);
  });

  it('marks a renamed personal workspace by its kind, and sends nothing else of the row', async () => {
    const { service, prisma } = setup();
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'u-renamed',
        name: 'Nusrat Jahan',
        email: 'nusrat@example.com',
        ownedBusinesses: [
          { ...business('আমার হিসাব', { id: 'ws-own', isDefault: true, type: 'PERSONAL', plan: plan('Free', 0) }), pinHash: '$2b$10$hash', currency: 'BDT' },
          business('Jahan Boutique', { id: 'ws-shop' }),
        ],
      },
    ]);
    const { items } = await service.overview({});

    expect(items[0].workspaces).toEqual([
      { id: 'ws-own', name: 'আমার হিসাব', type: 'PERSONAL', isDefault: true },
      { id: 'ws-shop', name: 'Jahan Boutique', type: 'BUSINESS', isDefault: false },
    ]);
  });
});
