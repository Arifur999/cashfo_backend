import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Account, Prisma, SavingsGoal, SavingsGoalStatus } from '@prisma/client';
import { MONEY_ACCOUNT_SUBTYPES } from '../accounts/accounts.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TransactionsService } from '../transactions/transactions.service.js';
import { AddContributionDto } from './dto/add-contribution.dto.js';
import { CreateSavingsGoalDto } from './dto/create-savings-goal.dto.js';
import { CreateSavingsTransferDto } from './dto/create-savings-transfer.dto.js';
import { UpdateSavingsGoalDto } from './dto/update-savings-goal.dto.js';
import { UpdateSavingsGoalStatusDto } from './dto/update-savings-goal-status.dto.js';

@Injectable()
export class SavingsGoalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionsService: TransactionsService,
  ) {}

  async list(businessId: string, status?: SavingsGoalStatus) {
    const goals = await this.prisma.savingsGoal.findMany({
      where: { businessId, ...(status && { status }) },
      orderBy: { createdAt: 'asc' },
    });
    return Promise.all(goals.map((g) => this.toSummary(g)));
  }

  // Savings Overview card: totals across every goal regardless of status
  // (a Paused or Completed goal's saved money is still real money saved),
  // plus this-month figures for the Monthly Savings and Savings Rate rows.
  async getOverview(businessId: string) {
    const goals = await this.prisma.savingsGoal.findMany({ where: { businessId } });

    let totalSaved = new Prisma.Decimal(0);
    let totalGoals = new Prisma.Decimal(0);
    let monthlyTarget = new Prisma.Decimal(0);
    for (const goal of goals) {
      totalSaved = totalSaved.plus(await this.computeCurrentAmount(goal.id));
      totalGoals = totalGoals.plus(goal.targetAmount);
      if (goal.status === 'ACTIVE') {
        monthlyTarget = monthlyTarget.plus(new Prisma.Decimal(goal.targetAmount).dividedBy(goal.durationMonths));
      }
    }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const savedThisMonthAgg = await this.prisma.savingsGoalEntry.aggregate({
      _sum: { amount: true },
      where: { businessId, type: 'CONTRIBUTION', date: { gte: monthStart, lt: monthEnd } },
    });
    const savedThisMonth = savedThisMonthAgg._sum.amount ?? new Prisma.Decimal(0);

    // Same "categoryId != null picks exactly one side of the double-entry
    // pair" trick BudgetsService.listIncomeGoals() uses for "earned".
    const incomeThisMonthAgg = await this.prisma.transactionEntry.aggregate({
      _sum: { amount: true },
      where: {
        categoryId: { not: null },
        transaction: { businessId, status: 'POSTED', transactionType: 'INCOME', transactionDate: { gte: monthStart, lt: monthEnd } },
      },
    });
    const incomeThisMonth = incomeThisMonthAgg._sum.amount ?? new Prisma.Decimal(0);

    const remaining = Prisma.Decimal.max(0, totalGoals.minus(totalSaved));

    return {
      totalSaved: totalSaved.toFixed(2),
      totalGoals: totalGoals.toFixed(2),
      remaining: remaining.toFixed(2),
      progressPercent: totalGoals.isZero() ? 0 : Math.min(100, Math.round(totalSaved.dividedBy(totalGoals).times(100).toNumber())),
      monthlyTarget: monthlyTarget.toFixed(2),
      savedThisMonth: savedThisMonth.toFixed(2),
      monthlyProgressPercent: monthlyTarget.isZero() ? 0 : Math.min(999, Math.round(new Prisma.Decimal(savedThisMonth).dividedBy(monthlyTarget).times(100).toNumber())),
      savingsRatePercent: this.percent(savedThisMonth, incomeThisMonth),
    };
  }

  // Savings Overview page (/savings-goals/overview) -- same shape as
  // AccountBalanceService.getWalletsOverview() (Balance's own Overview
  // page), except each "row" is a SavingsGoal rather than a real Account:
  // there's no per-goal openingBalance (goals only ever start at 0, funded
  // purely by contributions), and "inactive" means status != ACTIVE
  // (Paused or Completed) rather than AccountStatus.ARCHIVED.
  async getAccountOverview(businessId: string) {
    const goals = await this.prisma.savingsGoal.findMany({ where: { businessId }, orderBy: { name: 'asc' } });
    const grouped = await this.prisma.savingsGoalEntry.groupBy({
      by: ['savingsGoalId', 'type'],
      where: { businessId },
      _sum: { amount: true },
    });

    const inByGoal = new Map<string, Prisma.Decimal>();
    const outByGoal = new Map<string, Prisma.Decimal>();
    for (const row of grouped) {
      const amount = new Prisma.Decimal(row._sum.amount ?? 0);
      const target = row.type === 'TRANSFER_OUT' ? outByGoal : inByGoal;
      target.set(row.savingsGoalId, (target.get(row.savingsGoalId) ?? new Prisma.Decimal(0)).plus(amount));
    }

    let totalBalance = new Prisma.Decimal(0);
    let inactiveAmount = new Prisma.Decimal(0);
    const rows = goals.map((goal) => {
      const totalIn = inByGoal.get(goal.id) ?? new Prisma.Decimal(0);
      const totalOut = outByGoal.get(goal.id) ?? new Prisma.Decimal(0);
      const currentBalance = totalIn.minus(totalOut);
      totalBalance = totalBalance.plus(currentBalance);
      if (goal.status !== 'ACTIVE') inactiveAmount = inactiveAmount.plus(currentBalance);

      return {
        id: goal.id,
        name: goal.name,
        status: goal.status,
        openingBalance: '0.00',
        totalIn: totalIn.toFixed(2),
        totalOut: totalOut.toFixed(2),
        currentBalance: currentBalance.toFixed(2),
      };
    });

    return {
      totalAccounts: goals.length,
      totalBalance: totalBalance.toFixed(2),
      inactiveAmount: inactiveAmount.toFixed(2),
      availableBalance: totalBalance.minus(inactiveAmount).toFixed(2),
      accounts: rows,
    };
  }

  // Savings Transfer page's history table -- every TRANSFER_OUT entry
  // business-wide, each already paired 1:1 with a TRANSFER_IN on the other
  // goal (see transfer()), so this alone is enough to reconstruct every
  // "Goal A -> Goal B" row without also fetching the TRANSFER_IN half.
  async listTransfers(businessId: string) {
    const outEntries = await this.prisma.savingsGoalEntry.findMany({
      where: { businessId, type: 'TRANSFER_OUT' },
      orderBy: { date: 'desc' },
    });
    const goalIds = [...new Set(outEntries.flatMap((e) => [e.savingsGoalId, e.relatedGoalId].filter((v): v is string => !!v)))];
    const goals = goalIds.length ? await this.prisma.savingsGoal.findMany({ where: { id: { in: goalIds } } }) : [];
    const nameById = new Map(goals.map((g) => [g.id, g.name]));

    return outEntries.map((e) => ({
      id: e.id,
      date: e.date,
      amount: e.amount.toFixed(2),
      fromGoalId: e.savingsGoalId,
      fromGoalName: nameById.get(e.savingsGoalId) ?? '(deleted goal)',
      toGoalId: e.relatedGoalId,
      toGoalName: e.relatedGoalId ? (nameById.get(e.relatedGoalId) ?? '(deleted goal)') : '(deleted goal)',
      notes: e.notes,
    }));
  }

  async getOne(businessId: string, id: string) {
    const goal = await this.requireGoal(businessId, id);
    const entries = await this.prisma.savingsGoalEntry.findMany({ where: { savingsGoalId: id }, orderBy: { date: 'desc' } });

    const accountIds = [
      ...new Set([...entries.map((e) => e.moneyAccountId), ...entries.map((e) => e.savingsAccountId)].filter((v): v is string => !!v)),
    ];
    const relatedGoalIds = [...new Set(entries.map((e) => e.relatedGoalId).filter((v): v is string => !!v))];
    const [accounts, relatedGoals] = await Promise.all([
      accountIds.length ? this.prisma.account.findMany({ where: { id: { in: accountIds } } }) : Promise.resolve([]),
      relatedGoalIds.length ? this.prisma.savingsGoal.findMany({ where: { id: { in: relatedGoalIds } } }) : Promise.resolve([]),
    ]);
    const accountNameById = new Map(accounts.map((a) => [a.id, a.name]));
    const goalNameById = new Map(relatedGoals.map((g) => [g.id, g.name]));

    return {
      ...(await this.toSummary(goal)),
      entries: entries.map((e) => ({
        id: e.id,
        type: e.type,
        amount: e.amount.toFixed(2),
        date: e.date,
        moneyAccountName: e.moneyAccountId ? (accountNameById.get(e.moneyAccountId) ?? null) : null,
        savingsAccountName: e.savingsAccountId ? (accountNameById.get(e.savingsAccountId) ?? null) : null,
        relatedGoalName: e.relatedGoalId ? (goalNameById.get(e.relatedGoalId) ?? null) : null,
        notes: e.notes,
      })),
    };
  }

  async create(businessId: string, dto: CreateSavingsGoalDto) {
    return this.prisma.savingsGoal.create({
      data: {
        businessId,
        name: dto.name,
        targetAmount: dto.targetAmount,
        targetDate: new Date(dto.targetDate),
        durationMonths: dto.durationMonths,
        reminderDate: dto.reminderDate ? new Date(dto.reminderDate) : undefined,
        reminderChannel: dto.reminderChannel,
        description: dto.description,
      },
    });
  }

  async update(businessId: string, id: string, dto: UpdateSavingsGoalDto) {
    await this.requireGoal(businessId, id);
    return this.prisma.savingsGoal.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.targetAmount !== undefined && { targetAmount: dto.targetAmount }),
        ...(dto.targetDate !== undefined && { targetDate: new Date(dto.targetDate) }),
        ...(dto.durationMonths !== undefined && { durationMonths: dto.durationMonths }),
        ...(dto.reminderDate !== undefined && { reminderDate: new Date(dto.reminderDate) }),
        ...(dto.reminderChannel !== undefined && { reminderChannel: dto.reminderChannel }),
        ...(dto.description !== undefined && { description: dto.description }),
      },
    });
  }

  async updateStatus(businessId: string, id: string, dto: UpdateSavingsGoalStatusDto) {
    await this.requireGoal(businessId, id);
    return this.prisma.savingsGoal.update({ where: { id }, data: { status: dto.status } });
  }

  // Hard-delete only when nothing has ever been contributed/transferred --
  // same "protect records with real activity" rule as
  // ContactsService.archive(). There's no withdrawal flow yet, so a funded
  // goal can only be paused, not deleted, until one exists.
  async delete(businessId: string, id: string) {
    await this.requireGoal(businessId, id);
    const entryCount = await this.prisma.savingsGoalEntry.count({ where: { savingsGoalId: id } });
    if (entryCount > 0) {
      throw new BadRequestException('This goal has contributions or transfers recorded against it. Pause it instead of deleting.');
    }
    await this.prisma.savingsGoal.delete({ where: { id } });
    return { id };
  }

  // "Add Funds" -- real cash leaves a wallet/bank/mfs account and lands in
  // whichever Savings Wallet the user picked, via the same double-entry
  // Transaction engine every other money movement in this app uses (see
  // QuickEntriesService.createTransfer(), which this mirrors exactly).
  async addContribution(businessId: string, goalId: string, dto: AddContributionDto, userId: string) {
    const goal = await this.requireGoal(businessId, goalId);
    const fromAccount = await this.requireMoneyAccount(businessId, dto.moneyAccountId);
    const savingsAccount = await this.requireSavingsAccount(businessId, dto.toAccountId);

    const transaction = await this.transactionsService.createTransaction(
      businessId,
      {
        transactionType: 'TRANSFER',
        transactionDate: dto.date,
        description: dto.notes ? `Savings contribution: ${goal.name} -- ${dto.notes}` : `Savings contribution: ${goal.name}`,
        entries: [
          { accountId: savingsAccount.id, entryType: 'DEBIT', amount: dto.amount },
          { accountId: fromAccount.id, entryType: 'CREDIT', amount: dto.amount },
        ],
      },
      userId,
    );

    return this.prisma.savingsGoalEntry.create({
      data: {
        savingsGoalId: goalId,
        businessId,
        type: 'CONTRIBUTION',
        amount: dto.amount,
        date: new Date(dto.date),
        moneyAccountId: fromAccount.id,
        savingsAccountId: savingsAccount.id,
        transactionId: transaction.id,
        notes: dto.notes,
      },
    });
  }

  // Internal reallocation between two goals -- the cash never leaves the
  // pooled Savings account, so no real Transaction is created, just a
  // matched TRANSFER_OUT/TRANSFER_IN pair.
  async transfer(businessId: string, dto: CreateSavingsTransferDto) {
    if (dto.fromGoalId === dto.toGoalId) {
      throw new BadRequestException('Cannot transfer a goal to itself');
    }
    const fromGoal = await this.requireGoal(businessId, dto.fromGoalId);
    const toGoal = await this.requireGoal(businessId, dto.toGoalId);

    const fromCurrent = await this.computeCurrentAmount(fromGoal.id);
    if (fromCurrent.lessThan(dto.amount)) {
      throw new BadRequestException(`"${fromGoal.name}" only has ${fromCurrent.toFixed(2)} saved -- cannot transfer ${dto.amount.toFixed(2)}`);
    }

    const date = new Date(dto.date);
    return this.prisma.$transaction([
      this.prisma.savingsGoalEntry.create({
        data: { savingsGoalId: fromGoal.id, businessId, type: 'TRANSFER_OUT', amount: dto.amount, date, relatedGoalId: toGoal.id, notes: dto.notes },
      }),
      this.prisma.savingsGoalEntry.create({
        data: { savingsGoalId: toGoal.id, businessId, type: 'TRANSFER_IN', amount: dto.amount, date, relatedGoalId: fromGoal.id, notes: dto.notes },
      }),
    ]);
  }

  private async toSummary(goal: SavingsGoal) {
    const currentAmount = await this.computeCurrentAmount(goal.id);
    const target = new Prisma.Decimal(goal.targetAmount);
    return {
      ...goal,
      targetAmount: target.toFixed(2),
      currentAmount: currentAmount.toFixed(2),
      progressPercent: target.isZero() ? 0 : Math.min(100, Math.round(currentAmount.dividedBy(target).times(100).toNumber())),
      monthlyTarget: target.dividedBy(goal.durationMonths).toFixed(2),
    };
  }

  private async computeCurrentAmount(goalId: string): Promise<Prisma.Decimal> {
    const grouped = await this.prisma.savingsGoalEntry.groupBy({ by: ['type'], where: { savingsGoalId: goalId }, _sum: { amount: true } });
    let total = new Prisma.Decimal(0);
    for (const row of grouped) {
      const amount = new Prisma.Decimal(row._sum.amount ?? 0);
      total = row.type === 'TRANSFER_OUT' ? total.minus(amount) : total.plus(amount);
    }
    return total;
  }

  private percent(part: Prisma.Decimal.Value, whole: Prisma.Decimal.Value): number {
    const wholeDecimal = new Prisma.Decimal(whole);
    if (wholeDecimal.isZero()) return 0;
    return Math.min(999, Math.round(new Prisma.Decimal(part).dividedBy(wholeDecimal).times(100).toNumber()));
  }

  private async requireSavingsAccount(businessId: string, accountId: string): Promise<Account> {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account || account.businessId !== businessId) {
      throw new BadRequestException('toAccountId: account not found in this workspace');
    }
    if (account.accountType !== 'ASSET' || account.accountSubtype !== 'savings') {
      throw new BadRequestException('toAccountId must be a Savings Wallet -- add one first under Savings Goals > Wallet');
    }
    return account;
  }

  private async requireMoneyAccount(businessId: string, accountId: string): Promise<Account> {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account || account.businessId !== businessId) {
      throw new BadRequestException('moneyAccountId: account not found in this workspace');
    }
    if (account.accountType !== 'ASSET' || !account.accountSubtype || !MONEY_ACCOUNT_SUBTYPES.includes(account.accountSubtype)) {
      throw new BadRequestException('moneyAccountId must be a cash/bank/mobile-money account');
    }
    return account;
  }

  private async requireGoal(businessId: string, id: string) {
    const goal = await this.prisma.savingsGoal.findUnique({ where: { id } });
    if (!goal || goal.businessId !== businessId) {
      throw new NotFoundException('Savings goal not found');
    }
    return goal;
  }
}
