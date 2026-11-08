import { BadRequestException } from '@nestjs/common';
import { GroupExpensesService } from './group-expenses.service.js';

const RAKIB = '11111111-1111-4111-8111-111111111111';
const ARIF = '22222222-2222-4222-8222-222222222222';
const GONE = '33333333-3333-4333-8333-333333333333';

// A category "Kids' school" shared by Rakib only, in a group where Arif is
// also a member and GONE has since left.
const setup = (category: Record<string, unknown> = {}) => {
  const option = { id: 'cat-1', businessId: 'b1', name: "Kids' school", defaultSplit: 'EQUAL', defaultMemberIds: [RAKIB], ...category };
  const members = [
    { id: RAKIB, businessId: 'b1', status: 'ACTIVE' },
    { id: ARIF, businessId: 'b1', status: 'ACTIVE' },
    { id: GONE, businessId: 'b1', status: 'ARCHIVED' },
  ];
  const inGroup = ({ where }: { where: { id: { in: string[] }; status?: string } }) =>
    members.filter((member) => where.id.in.includes(member.id) && (!where.status || member.status === where.status));
  const prisma = {
    groupMember: {
      count: vi.fn(async (args: { where: { id: { in: string[] } } }) => inGroup(args).length),
      findMany: vi.fn(async (args: { where: { id: { in: string[] }; status?: string } }) => inGroup(args).map(({ id }) => ({ id }))),
    },
    groupExpenseCategoryOption: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; businessId_name?: unknown } }) => (where.id === 'cat-1' || where.businessId_name ? option : null)),
      count: vi.fn().mockResolvedValue(1),
      create: vi.fn(async ({ data }: { data: unknown }) => data),
      update: vi.fn(async ({ data }: { data: unknown }) => data),
    },
    groupExpense: { create: vi.fn(async ({ data }: { data: unknown }) => data), updateMany: vi.fn() },
    groupSettings: { findUnique: vi.fn().mockResolvedValue(null) },
    groupActivity: { create: vi.fn() },
    $transaction: vi.fn(async (work: (tx: unknown) => unknown) => work(prisma)),
  };
  return { service: new GroupExpensesService(prisma as never), prisma };
};

const expense = { amount: '1200', date: '2026-10-20', category: "Kids' school" };

describe('a category shared by only selected members', () => {
  it('shares a new expense in it among those members still in the group', async () => {
    const { service, prisma } = setup({ defaultMemberIds: [RAKIB, GONE] });
    await service.createExpense('b1', expense as never);
    expect(prisma.groupExpense.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ split: 'EQUAL', splits: { create: [{ groupMemberId: RAKIB, units: null, amount: null }] } }) }),
    );
  });

  it('lets an expense name its own members instead', async () => {
    const { service, prisma } = setup();
    await service.createExpense('b1', { ...expense, splits: [{ groupMemberId: ARIF }] } as never);
    expect(prisma.groupExpense.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ splits: { create: [{ groupMemberId: ARIF, units: null, amount: null }] } }) }));
  });

  it('falls back to everyone when none of its members is left', async () => {
    const { service, prisma } = setup({ defaultMemberIds: [GONE] });
    await service.createExpense('b1', expense as never);
    expect(prisma.groupExpense.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ splits: { create: [] } }) }));
  });

  it('keeps the chosen members, each once, on a new category', async () => {
    const { service, prisma } = setup();
    prisma.groupExpenseCategoryOption.findUnique.mockResolvedValueOnce(null as never);
    await service.createExpenseCategory('b1', { name: 'Tuition', color: 'emerald', defaultMemberIds: [RAKIB, RAKIB] } as never);
    expect(prisma.groupExpenseCategoryOption.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ defaultMemberIds: [RAKIB] }) }));
  });

  it('refuses someone from outside the group, and members on a category not shared equally', async () => {
    const { service, prisma } = setup();
    prisma.groupExpenseCategoryOption.findUnique.mockResolvedValue(null as never);
    await expect(service.createExpenseCategory('b1', { name: 'A', color: 'emerald', defaultMemberIds: ['44444444-4444-4444-8444-444444444444'] } as never)).rejects.toThrow(BadRequestException);
    await expect(service.createExpenseCategory('b1', { name: 'B', color: 'emerald', defaultSplit: 'SHARES', defaultMemberIds: [RAKIB] } as never)).rejects.toThrow(BadRequestException);
  });

  it('forgets its members when it is switched to another way of sharing', async () => {
    const { service, prisma } = setup();
    await service.updateExpenseCategory('b1', 'cat-1', { defaultSplit: 'SHARES' } as never);
    expect(prisma.groupExpenseCategoryOption.update).toHaveBeenCalledWith(expect.objectContaining({ data: { defaultSplit: 'SHARES', defaultMemberIds: [] } }));
  });
});
