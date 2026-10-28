import { UserNotificationsService } from './user-notifications.service.js';

type Switches = { remindBudget: boolean; remindLoans: boolean; remindSavings: boolean };

const setup = ({
  switches = { remindBudget: true, remindLoans: false, remindSavings: false } as Switches,
  workspaces = [{ id: 'b1', type: 'PERSONAL', planId: null }],
} = {}) => {
  const prisma = {
    user: {
      // The checks are due: this read claims them.
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue(switches),
    },
    business: { findMany: vi.fn().mockResolvedValue(workspaces) },
    defaultCategory: {
      findMany: vi.fn().mockResolvedValue([
        { name: 'Shopping', nameBn: 'কেনাকাটা' },
        { name: 'Food', nameBn: 'খাবার' },
      ]),
    },
    userNotification: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
  };
  const budgets = {
    getOverview: vi.fn().mockResolvedValue({
      categories: [
        { id: 'shop', name: 'shopping', monthlyLimit: '5000.00', spent: '4900.00' },
        { id: 'tea', name: 'Tea stall', monthlyLimit: '1000.00', spent: '1200.00' },
      ],
    }),
  };
  const announcements = { forCustomer: vi.fn().mockResolvedValue([]) };
  const service = new UserNotificationsService(
    prisma as never,
    budgets as never,
    {} as never,
    {} as never,
    announcements as never,
    { configured: false } as never,
  );
  return { service, prisma, budgets };
};

describe('UserNotificationsService budget reminders', () => {
  it("gives each one its category's Bangla name from the default expense categories, or null", async () => {
    const { service, prisma } = setup();
    await service.feed('u1');

    expect(prisma.defaultCategory.findMany).toHaveBeenCalledWith({
      where: { type: 'EXPENSE' },
      orderBy: [{ isActive: 'desc' }, { displayOrder: 'asc' }],
      select: { name: true, nameBn: true },
    });
    const rows = prisma.userNotification.createMany.mock.calls[0][0].data;
    expect(rows.map((row: { data: Record<string, unknown> }) => [row.data.category, row.data.categoryBn])).toEqual([
      ['shopping', 'কেনাকাটা'],
      ['Tea stall', null],
    ]);
    expect(rows[0]).toMatchObject({ userId: 'u1', type: 'BUDGET', businessId: 'b1', key: expect.stringMatching(/^budget:shop:\d{4}-\d{2}:90$/) });
  });

  it('looks the names up once, however many workspaces there are', async () => {
    const { service, prisma, budgets } = setup({
      workspaces: [
        { id: 'b1', type: 'PERSONAL', planId: null },
        { id: 'b2', type: 'BUSINESS', planId: null },
      ],
    });
    await service.feed('u1');
    expect(budgets.getOverview).toHaveBeenCalledTimes(2);
    expect(prisma.defaultCategory.findMany).toHaveBeenCalledTimes(1);
  });

  it('reads no names with budget reminders off, or with only group workspaces', async () => {
    const off = setup({ switches: { remindBudget: false, remindLoans: false, remindSavings: false } });
    await off.service.feed('u1');
    expect(off.prisma.defaultCategory.findMany).not.toHaveBeenCalled();

    const groupsOnly = setup({ workspaces: [{ id: 'g1', type: 'GROUP', planId: null }] });
    await groupsOnly.service.feed('u1');
    expect(groupsOnly.prisma.defaultCategory.findMany).not.toHaveBeenCalled();
    expect(groupsOnly.budgets.getOverview).not.toHaveBeenCalled();

    // The checks ran to the end (a failed one is only logged): the clean-up
    // after them happened.
    expect(off.prisma.userNotification.deleteMany).toHaveBeenCalled();
    expect(groupsOnly.prisma.userNotification.deleteMany).toHaveBeenCalled();
  });
});
