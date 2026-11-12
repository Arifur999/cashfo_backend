import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SavingsGoalsService } from './savings-goals.service.js';
import type { AddProfitDto } from './dto/add-profit.dto.js';
import type { CreateSavingsGoalDto } from './dto/create-savings-goal.dto.js';

type Internals = { maybeMarkCompleted: (value: unknown) => Promise<unknown> };

const WALLET = { id: 'dps', businessId: 'biz-1', accountType: 'ASSET', accountSubtype: 'savings', status: 'ACTIVE' };
const INCOME = [
  { id: 'salary', name: 'Salary Income', accountType: 'INCOME' },
  { id: 'interest', name: 'Interest Income', accountType: 'INCOME' },
];

const PLAN = { id: 'plan-9', businessId: 'biz-1', name: 'Hajj', category: 'umrah', color: '#235347', amount: new Prisma.Decimal(750000), horizon: 'BY_DATE', needBy: new Date('2029-05-31'), priority: 'HIGH', note: 'For Abba', link: null, plannedOn: new Date('2026-08-02'), fromGoal: null };

const setup = (goalOver: Record<string, unknown> = {}, entryCount = 0, planGone = false, entries: Record<string, unknown>[] = [], plan: Record<string, unknown> | null = PLAN) => {
  const goal = {
    id: 'goal-1',
    businessId: 'biz-1',
    name: 'Umrah trip',
    status: 'ACTIVE',
    accountId: 'dps',
    targetAmount: new Prisma.Decimal(300000),
    targetDate: new Date('2099-12-31'),
    description: 'With flights',
    color: '#b0593a',
    durationMonths: 30,
    startAmount: new Prisma.Decimal(0),
    planStartAmount: null,
    planStartDate: null,
    reminderDate: null,
    reminderChannel: null,
    reachedAt: null,
    monthlyReminder: false,
    fromPlan: null,
    createdAt: new Date('2026-11-03T12:00:00.000Z'),
    ...goalOver,
  };
  const tx = {
    savingsGoal: {
      findUnique: vi.fn(() => Promise.resolve(goal)),
      delete: vi.fn(() => Promise.resolve(goal)),
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'goal-new', ...data })),
    },
    savingsGoalEntry: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'e-1', ...data })),
      count: vi.fn(() => Promise.resolve(entryCount)),
      findMany: vi.fn(() => Promise.resolve(entries)),
      delete: vi.fn(() => Promise.resolve({})),
    },
    savingsPlan: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'plan-1', ...data })),
      deleteMany: vi.fn(() => Promise.resolve({ count: planGone ? 0 : 1 })),
      findUnique: vi.fn(() => Promise.resolve(plan)),
    },
    account: { findUnique: vi.fn(() => Promise.resolve(WALLET)), findMany: vi.fn(() => Promise.resolve(INCOME)) },
  };
  const prisma = {
    savingsGoal: { findUnique: vi.fn(() => Promise.resolve(goal)), create: vi.fn() },
    $transaction: vi.fn((run: (client: typeof tx) => Promise<unknown>) => run(tx)),
  };
  const transactions = {
    withLocks: vi.fn((_keys: string[], run: (client: typeof tx) => Promise<unknown>) => run(tx)),
    createTransaction: vi.fn(() => Promise.resolve({ id: 'txn-1' })),
    voidTransaction: vi.fn(() => Promise.resolve({})),
  };
  const service = new SavingsGoalsService(prisma as never, transactions as never, {} as never);
  vi.spyOn(service as unknown as Internals, 'maybeMarkCompleted').mockImplementation((value) => Promise.resolve(value));
  return { service, tx, prisma, transactions };
};

const profit = (over: Partial<AddProfitDto> = {}) => ({ amount: 1200, date: '2026-11-10', category: 'Bank profit', ...over }) as AddProfitDto;

describe('Add profit on a savings goal', () => {
  it('posts income into the savings account the goal keeps its money in and records a PROFIT entry', async () => {
    const { service, tx, transactions } = setup();
    await service.addProfit('biz-1', 'goal-1', profit({ notes: 'Jan to Jun' }), 'u-1');
    // Counted under an income account named for profit or interest when there is one.
    expect(transactions.createTransaction).toHaveBeenCalledWith(
      'biz-1',
      expect.objectContaining({
        transactionType: 'INCOME',
        entries: [
          { accountId: 'dps', entryType: 'DEBIT', amount: 1200 },
          { accountId: 'interest', entryType: 'CREDIT', amount: 1200, categoryId: 'Bank profit', note: 'Jan to Jun' },
        ],
      }),
      'u-1',
      tx,
    );
    expect(tx.savingsGoalEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'PROFIT', savingsAccountId: 'dps', transactionId: 'txn-1', category: 'Bank profit' }),
    });
  });

  it('needs the account the goal keeps its money in, and refuses a withdrawn goal', async () => {
    await expect(setup({ accountId: null }).service.addProfit('biz-1', 'goal-1', profit(), 'u-1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(setup({ status: 'WITHDRAWN' }).service.addProfit('biz-1', 'goal-1', profit(), 'u-1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('Saving plans and goals', () => {
  it('moves a goal with nothing recorded back to plans, keeping its name, colour, amount, date and note', async () => {
    const { service, tx } = setup();
    await expect(service.moveToPlans('biz-1', 'goal-1')).resolves.toEqual({ planId: 'plan-1' });
    expect(tx.savingsPlan.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Umrah trip',
        color: '#b0593a',
        amount: new Prisma.Decimal(300000),
        horizon: 'BY_DATE',
        needBy: new Date('2099-12-31'),
        note: 'With flights',
      }),
    });
    expect(tx.savingsGoal.delete).toHaveBeenCalledWith({ where: { id: 'goal-1' } });
  });

  it('keeps a goal that has money history a goal', async () => {
    const { service, tx } = setup({}, 2);
    await expect(service.moveToPlans('biz-1', 'goal-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.savingsGoal.delete).not.toHaveBeenCalled();
  });

  it('starts a goal from a plan and removes the plan in the same transaction', async () => {
    const { service, tx } = setup();
    const dto = { name: 'Hajj', targetAmount: 750000, targetDate: '2029-05-31', durationMonths: 31, color: '#235347', fromPlanId: 'plan-9' } as CreateSavingsGoalDto;
    await service.create('biz-1', dto, 'u-1');
    expect(tx.savingsPlan.deleteMany).toHaveBeenCalledWith({ where: { id: 'plan-9', businessId: 'biz-1' } });
    // The goal keeps the plan as it was, for Undo.
    expect(tx.savingsGoal.create).toHaveBeenCalledWith({ data: expect.objectContaining({ name: 'Hajj', color: '#235347', fromPlan: expect.objectContaining({ name: 'Hajj', priority: 'HIGH', plannedOn: '2026-08-02T00:00:00.000Z' }) }) });
  });

  it('does not make a second goal from a plan already started', async () => {
    const { service, tx } = setup({}, 0, true);
    const dto = { name: 'Hajj', targetAmount: 750000, targetDate: '2029-05-31', durationMonths: 31, fromPlanId: 'plan-9' } as CreateSavingsGoalDto;
    await expect(service.create('biz-1', dto, 'u-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.savingsGoal.create).not.toHaveBeenCalled();
  });
});

describe('Undo of Start goal and of Move back to plans', () => {
  const snapshot = { name: 'Hajj', category: 'umrah', color: '#235347', amount: '750000.00', horizon: 'BY_DATE', needBy: '2029-05-31T00:00:00.000Z', priority: 'HIGH', note: 'For Abba', link: null, plannedOn: '2026-08-02T00:00:00.000Z' };

  it('puts the plan back as it was, reverses what was already saved and removes the goal', async () => {
    const opening = { id: 'e-0', type: 'CONTRIBUTION', moneyAccountId: null, transactionId: 'txn-open' };
    const { service, tx, transactions } = setup({ fromPlan: snapshot }, 1, false, [opening]);
    await expect(service.undoStart('biz-1', 'goal-1', 'u-1')).resolves.toEqual({ planId: 'plan-1' });
    // The entry goes before the void: a void refuses a posting a goal still owns.
    expect(tx.savingsGoalEntry.delete).toHaveBeenCalledWith({ where: { id: 'e-0' } });
    expect(transactions.voidTransaction).toHaveBeenCalledWith('biz-1', 'txn-open', expect.any(String), 'u-1', tx);
    expect(tx.savingsPlan.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: 'Hajj', priority: 'HIGH', plannedOn: new Date('2026-08-02'), needBy: new Date('2029-05-31') }),
    });
    expect(tx.savingsGoal.delete).toHaveBeenCalledWith({ where: { id: 'goal-1' } });
  });

  it('keeps a goal money has moved for since it started', async () => {
    const deposit = { id: 'e-1', type: 'CONTRIBUTION', moneyAccountId: 'cash', transactionId: 'txn-1' };
    const { service, tx, transactions } = setup({ fromPlan: snapshot }, 1, false, [deposit]);
    await expect(service.undoStart('biz-1', 'goal-1', 'u-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(transactions.voidTransaction).not.toHaveBeenCalled();
    expect(tx.savingsGoal.delete).not.toHaveBeenCalled();
  });

  it('refuses a goal that was not started from a plan', async () => {
    await expect(setup({ fromPlan: null }).service.undoStart('biz-1', 'goal-1', 'u-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('moving back keeps the goal on the plan, and Undo makes it the same goal again', async () => {
    const moved = setup();
    await moved.service.moveToPlans('biz-1', 'goal-1');
    const created = (moved.tx.savingsPlan.create.mock.calls[0] as unknown as [{ data: { fromGoal: Record<string, unknown> } }])[0].data;
    expect(created.fromGoal).toEqual(expect.objectContaining({ id: 'goal-1', name: 'Umrah trip', accountId: 'dps', createdAt: '2026-11-03T12:00:00.000Z' }));

    const back = setup({}, 0, false, [], { ...PLAN, fromGoal: created.fromGoal });
    back.tx.account.findUnique = vi.fn(() => Promise.resolve({ ...WALLET, businessId: 'biz-1' }));
    await expect(back.service.backToGoal('biz-1', 'plan-9')).resolves.toEqual({ goalId: 'goal-1' });
    expect(back.tx.savingsPlan.deleteMany).toHaveBeenCalledWith({ where: { id: 'plan-9', businessId: 'biz-1' } });
    expect(back.tx.savingsGoal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ id: 'goal-1', name: 'Umrah trip', accountId: 'dps', createdAt: new Date('2026-11-03T12:00:00.000Z') }),
    });
  });

  it('refuses Undo on a plan that never was a goal', async () => {
    await expect(setup().service.backToGoal('biz-1', 'plan-9')).rejects.toBeInstanceOf(BadRequestException);
  });
});
