import { Prisma } from '@prisma/client';
import { SavingsGoalsService } from './savings-goals.service.js';
import type { UpdateSavingsGoalDto } from './dto/update-savings-goal.dto.js';

type Entry = { type: 'CONTRIBUTION' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'WITHDRAWAL'; amount: number };

// One goal with what was put in and taken out; just the Prisma calls that
// update() and the status rules make.
const setup = (status: string, targetAmount: number, entries: Entry[]) => {
  const goal = { id: 'goal-1', businessId: 'biz-1', name: 'Hajj', status, targetAmount: new Prisma.Decimal(targetAmount) };
  const prisma = {
    savingsGoal: {
      findUnique: vi.fn(() => Promise.resolve({ ...goal })),
      findUniqueOrThrow: vi.fn(() => Promise.resolve({ ...goal })),
      update: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        if (data.targetAmount !== undefined) goal.targetAmount = new Prisma.Decimal(data.targetAmount as number);
        if (data.name !== undefined) goal.name = data.name as string;
        return Promise.resolve({ ...goal });
      }),
      updateMany: vi.fn(({ where, data }: { where: { status: string | { in: string[] } }; data: { status: string } }) => {
        const allowed = typeof where.status === 'string' ? [where.status] : where.status.in;
        if (allowed.includes(goal.status)) goal.status = data.status;
        return Promise.resolve({ count: 1 });
      }),
    },
    savingsGoalEntry: {
      groupBy: vi.fn(() =>
        Promise.resolve(
          Object.entries(
            entries.reduce<Record<string, number>>((sums, entry) => ({ ...sums, [entry.type]: (sums[entry.type] ?? 0) + entry.amount }), {}),
          ).map(([type, amount]) => ({ type, _sum: { amount: new Prisma.Decimal(amount) } })),
        ),
      ),
    },
  };
  return { service: new SavingsGoalsService(prisma as never, {} as never, {} as never), goal };
};

const update = (dto: Partial<UpdateSavingsGoalDto>) => dto as UpdateSavingsGoalDto;

describe('SavingsGoalsService.update and the goal status', () => {
  it('reopens a completed goal whose target is raised above what is saved', async () => {
    const { service, goal } = setup('COMPLETED', 50000, [{ type: 'CONTRIBUTION', amount: 50000 }]);
    const result = await service.update('biz-1', 'goal-1', update({ targetAmount: 80000 }));
    expect(goal.status).toBe('ACTIVE');
    expect(result.status).toBe('ACTIVE');
  });

  it('completes an active goal whose target is lowered to what is saved', async () => {
    const { service, goal } = setup('ACTIVE', 80000, [{ type: 'CONTRIBUTION', amount: 50000 }]);
    await service.update('biz-1', 'goal-1', update({ targetAmount: 50000 }));
    expect(goal.status).toBe('COMPLETED');
  });

  // Marked complete by hand, below its target: a rename leaves it so.
  it("leaves the status alone when the target doesn't change", async () => {
    const { service, goal } = setup('COMPLETED', 80000, [{ type: 'CONTRIBUTION', amount: 20000 }]);
    await service.update('biz-1', 'goal-1', update({ name: 'Umrah' }));
    expect(goal.status).toBe('COMPLETED');
  });

  it('never reopens a withdrawn goal', async () => {
    const { service, goal } = setup('WITHDRAWN', 50000, [{ type: 'CONTRIBUTION', amount: 50000 }, { type: 'WITHDRAWAL', amount: 50000 }]);
    await service.update('biz-1', 'goal-1', update({ targetAmount: 90000 }));
    expect(goal.status).toBe('WITHDRAWN');
  });

  it('counts moves out of the goal against what is saved', async () => {
    const { service, goal } = setup('COMPLETED', 50000, [{ type: 'CONTRIBUTION', amount: 60000 }, { type: 'TRANSFER_OUT', amount: 15000 }]);
    await service.update('biz-1', 'goal-1', update({ targetAmount: 50000 }));
    expect(goal.status).toBe('ACTIVE');
  });
});
