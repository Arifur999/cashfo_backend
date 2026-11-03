import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SavingsGoalsService } from './savings-goals.service.js';
import type { UpdateSavingsGoalDto } from './dto/update-savings-goal.dto.js';

// The private helpers a test stands in for.
type Internals = { ledger: () => Promise<unknown>; maybeMarkCompleted: (value: unknown) => Promise<unknown> };
const internals = (service: SavingsGoalsService) => service as unknown as Internals;
const D = (value: number) => new Prisma.Decimal(value);

const ACCOUNTS: Record<string, Record<string, unknown>> = {
  dps: { id: 'dps', name: 'Islami Bank DPS', businessId: 'biz-1', accountType: 'ASSET', accountSubtype: 'savings', status: 'ACTIVE', currentBalance: D(5000) },
  bkash: { id: 'bkash', name: 'bKash savings', businessId: 'biz-1', accountType: 'ASSET', accountSubtype: 'savings', status: 'ACTIVE', currentBalance: D(500) },
  fdr: { id: 'fdr', name: 'City Bank FDR', businessId: 'biz-1', accountType: 'ASSET', accountSubtype: 'savings', status: 'ACTIVE', currentBalance: D(0) },
};

// A goal kept in DPS with 3,000 there and 500 in bKash, moving to the FDR.
const setup = (holdings: [string, number][] = [['dps', 3000], ['bkash', 500]]) => {
  const goal = { id: 'goal-1', businessId: 'biz-1', name: 'Hajj', status: 'ACTIVE', accountId: 'dps', reminderDate: null, targetAmount: D(100000) };
  const findAccount = vi.fn(({ where }: { where: { id: string } }) => Promise.resolve(ACCOUNTS[where.id] ?? null));
  const tx = {
    account: { findUnique: findAccount },
    savingsGoal: { update: vi.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...goal, ...data })), findUnique: vi.fn(() => Promise.resolve(goal)), findFirst: vi.fn(() => Promise.resolve(goal)) },
    savingsGoalEntry: { create: vi.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'e', ...data })) },
  };
  const prisma = { ...tx, savingsGoal: { ...tx.savingsGoal, update: vi.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...goal, ...data })) } };
  const transactions = {
    withLocks: vi.fn((_keys: string[], run: (client: typeof tx) => Promise<unknown>) => run(tx)),
    createTransaction: vi.fn(() => Promise.resolve({ id: 'txn-1' })),
  };
  const service = new SavingsGoalsService(prisma as never, transactions as never, {} as never);
  vi.spyOn(internals(service), 'ledger').mockResolvedValue({ holdings: new Map([['goal-1', new Map(holdings.map(([id, amount]) => [id, D(amount)]))]]) });
  vi.spyOn(internals(service), 'maybeMarkCompleted').mockImplementation((value) => Promise.resolve(value));
  return { service, prisma, tx, transactions };
};
const edit = (over: Partial<UpdateSavingsGoalDto>) => over as UpdateSavingsGoalDto;

describe('SavingsGoalsService.update moving a goal to another account', () => {
  it('moves what each other wallet holds for the goal into the new one, in one posting with the goal', async () => {
    const { service, tx, transactions } = setup();
    await service.update('biz-1', 'goal-1', edit({ accountId: 'fdr', name: 'Hajj 2027' }), 'u-1');

    expect(transactions.withLocks).toHaveBeenCalledWith(['savings-goal:goal-1', 'account:fdr', 'account:dps', 'account:bkash'], expect.any(Function));
    expect(transactions.createTransaction).toHaveBeenCalledWith(
      'biz-1',
      expect.objectContaining({
        transactionType: 'TRANSFER',
        entries: [
          { accountId: 'fdr', entryType: 'DEBIT', amount: 3500 },
          { accountId: 'dps', entryType: 'CREDIT', amount: 3000 },
          { accountId: 'bkash', entryType: 'CREDIT', amount: 500 },
        ],
      }),
      'u-1',
      tx,
    );
    const entries = tx.savingsGoalEntry.create.mock.calls.map(([{ data }]) => data);
    expect(entries.map((e) => [e.type, e.moneyAccountId, e.savingsAccountId, Number(e.amount), e.transactionId])).toEqual([
      ['ACCOUNT_CHANGE', 'dps', 'fdr', 3000, 'txn-1'],
      ['ACCOUNT_CHANGE', 'bkash', 'fdr', 500, 'txn-1'],
    ]);
    expect(entries[0].groupId).toBe(entries[1].groupId);
    expect(tx.savingsGoal.update).toHaveBeenCalledWith({ where: { id: 'goal-1' }, data: expect.objectContaining({ accountId: 'fdr', name: 'Hajj 2027' }) });
  });

  it('only changes the account when nothing is saved anywhere else', async () => {
    const { service, tx, transactions } = setup([['fdr', 2000]]);
    await service.update('biz-1', 'goal-1', edit({ accountId: 'fdr' }), 'u-1');
    expect(transactions.createTransaction).not.toHaveBeenCalled();
    expect(tx.savingsGoalEntry.create).not.toHaveBeenCalled();
    expect(tx.savingsGoal.update).toHaveBeenCalledWith({ where: { id: 'goal-1' }, data: expect.objectContaining({ accountId: 'fdr' }) });
  });

  it('refuses when a wallet holds less than the goal keeps there, and changes nothing', async () => {
    const { service, tx, transactions } = setup([['dps', 3000], ['bkash', 900]]);
    await expect(service.update('biz-1', 'goal-1', edit({ accountId: 'fdr' }), 'u-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(transactions.createTransaction).not.toHaveBeenCalled();
    expect(tx.savingsGoal.update).not.toHaveBeenCalled();
  });

  it('leaves the money alone on an edit that keeps the account', async () => {
    const { service, prisma, transactions } = setup();
    await service.update('biz-1', 'goal-1', edit({ accountId: 'dps', name: 'Hajj 2027' }), 'u-1');
    expect(transactions.withLocks).not.toHaveBeenCalled();
    expect(prisma.savingsGoal.update).toHaveBeenCalledWith({ where: { id: 'goal-1' }, data: expect.objectContaining({ name: 'Hajj 2027' }) });
  });
});
