import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SavingsGoalsService } from './savings-goals.service.js';
import type { AddContributionDto } from './dto/add-contribution.dto.js';
import type { CreateSavingsGoalDto } from './dto/create-savings-goal.dto.js';

const ACCOUNTS: Record<string, Record<string, unknown>> = {
  dps: { id: 'dps', businessId: 'biz-1', accountType: 'ASSET', accountSubtype: 'savings', status: 'ACTIVE' },
  fdr: { id: 'fdr', businessId: 'biz-1', accountType: 'ASSET', accountSubtype: 'savings', status: 'ARCHIVED' },
  cash: { id: 'cash', businessId: 'biz-1', accountType: 'ASSET', accountSubtype: 'cash', status: 'ACTIVE' },
};

// The account a goal keeps its money in: set when it is made, where deposits
// go when the request names none, and given to an older goal by its first.
const setup = (goalAccountId: string | null = null) => {
  const goal = { id: 'goal-1', businessId: 'biz-1', name: 'Hajj', status: 'ACTIVE', accountId: goalAccountId, targetAmount: new Prisma.Decimal(100000) };
  const tx = {
    savingsGoal: { update: vi.fn(() => Promise.resolve(goal)), findUnique: vi.fn(() => Promise.resolve(goal)) },
    savingsGoalEntry: { create: vi.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'e-1', ...data })) },
  };
  const prisma = {
    account: { findUnique: vi.fn(({ where }: { where: { id: string } }) => Promise.resolve(ACCOUNTS[where.id] ?? null)) },
    savingsGoal: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'goal-new', ...data })),
      findUnique: vi.fn(() => Promise.resolve(goal)),
    },
  };
  const transactions = {
    withLocks: vi.fn((_keys: string[], run: (client: typeof tx) => Promise<unknown>) => run(tx)),
    createTransaction: vi.fn(() => Promise.resolve({ id: 'txn-1' })),
  };
  const service = new SavingsGoalsService(prisma as never, transactions as never, {} as never);
  vi.spyOn(service as never, 'maybeMarkCompleted').mockImplementation(((value: unknown) => Promise.resolve(value)) as never);
  return { service, prisma, tx, transactions };
};

const create = (over: Partial<CreateSavingsGoalDto> = {}) =>
  ({ name: 'Hajj', targetAmount: 100000, targetDate: '2027-12-31', durationMonths: 14, ...over }) as CreateSavingsGoalDto;
const deposit = (over: Partial<AddContributionDto> = {}) => ({ moneyAccountId: 'cash', amount: 5000, date: '2026-11-03', ...over }) as AddContributionDto;

describe('SavingsGoalsService and the account a goal keeps its money in', () => {
  it('keeps the account a new goal is given', async () => {
    const { service, prisma } = setup();
    await service.create('biz-1', create({ accountId: 'dps' }), 'u-1');
    expect(prisma.savingsGoal.create).toHaveBeenCalledWith({ data: expect.objectContaining({ accountId: 'dps' }) });
  });

  it('refuses an archived account or one that is not for savings', async () => {
    const { service, prisma } = setup();
    await expect(service.create('biz-1', create({ accountId: 'fdr' }), 'u-1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create('biz-1', create({ accountId: 'cash' }), 'u-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.savingsGoal.create).not.toHaveBeenCalled();
  });

  it('puts a deposit that names no account into the goal’s own', async () => {
    const { service, tx, transactions } = setup('dps');
    vi.spyOn(service as never, 'requireMoneyAccount').mockResolvedValue(ACCOUNTS.cash as never);
    await service.addContribution('biz-1', 'goal-1', deposit(), 'u-1');
    expect(transactions.createTransaction).toHaveBeenCalledWith(
      'biz-1',
      expect.objectContaining({ entries: [expect.objectContaining({ accountId: 'dps', entryType: 'DEBIT' }), expect.objectContaining({ accountId: 'cash' })] }),
      'u-1',
      tx,
    );
    expect(tx.savingsGoal.update).not.toHaveBeenCalled();
  });

  it('gives an older goal with no account the one its first deposit went into', async () => {
    const { service, tx } = setup(null);
    vi.spyOn(service as never, 'requireMoneyAccount').mockResolvedValue(ACCOUNTS.cash as never);
    await service.addContribution('biz-1', 'goal-1', deposit({ toAccountId: 'dps' }), 'u-1');
    expect(tx.savingsGoal.update).toHaveBeenCalledWith({ where: { id: 'goal-1' }, data: { accountId: 'dps' } });
  });

  it('asks where the money goes when neither the goal nor the request says', async () => {
    const { service } = setup(null);
    vi.spyOn(service as never, 'requireMoneyAccount').mockResolvedValue(ACCOUNTS.cash as never);
    await expect(service.addContribution('biz-1', 'goal-1', deposit(), 'u-1')).rejects.toThrow('Pick the savings account');
  });
});
