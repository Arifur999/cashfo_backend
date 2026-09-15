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
import { WithdrawSavingsGoalDto } from './dto/withdraw-savings-goal.dto.js';

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
  // page), except scoped to accountSubtype "savings": every real Savings
  // Wallet the user funds goals from/into (see requireSavingsAccount()).
  // The one hidden pooled system account every business gets (from before
  // this feature's per-wallet redesign) is excluded here too UNLESS it
  // still holds a real un-migrated balance -- while it does, hiding it
  // would make this table's totals silently stop reconciling with what
  // Savings Goals reports as saved; once a business merges that balance
  // into a real wallet (a real TRANSFER transaction, not a raw edit -- see
  // this app's `merge legacy pooled Savings balance` transactions), its
  // balance is 0 and it stops showing up here on its own, no manual
  // archiving needed. Labelled distinctly while visible (see the
  // isSystemAccount ternary below) so it doesn't read as just another
  // wallet the user forgot they created. "Inactive" means
  // AccountStatus.ARCHIVED (a real archived Savings Wallet), not a goal's
  // own status -- this table is about where the money physically sits,
  // not per-goal progress (that's getOverview()/the Dashboard page, a
  // completely separate figure).
  async getAccountOverview(businessId: string) {
    const allWallets = await this.prisma.account.findMany({
      where: { businessId, accountType: 'ASSET', accountSubtype: 'savings' },
      orderBy: { displayOrder: 'asc' },
    });
    const wallets = allWallets.filter((w) => !w.isSystemAccount || !new Prisma.Decimal(w.currentBalance).isZero());
    const walletIds = wallets.map((w) => w.id);

    const grouped =
      walletIds.length === 0
        ? []
        : await this.prisma.transactionEntry.groupBy({
            by: ['accountId', 'entryType'],
            where: { accountId: { in: walletIds } },
            _sum: { amount: true },
          });

    const inByWallet = new Map<string, Prisma.Decimal>();
    const outByWallet = new Map<string, Prisma.Decimal>();
    for (const row of grouped) {
      const amount = new Prisma.Decimal(row._sum.amount ?? 0);
      const target = row.entryType === 'DEBIT' ? inByWallet : outByWallet;
      target.set(row.accountId, amount);
    }

    let totalBalance = new Prisma.Decimal(0);
    let inactiveAmount = new Prisma.Decimal(0);
    const rows = wallets.map((wallet) => {
      const balance = new Prisma.Decimal(wallet.currentBalance);
      totalBalance = totalBalance.plus(balance);
      if (wallet.status === 'ARCHIVED') inactiveAmount = inactiveAmount.plus(balance);

      return {
        id: wallet.id,
        name: wallet.isSystemAccount ? `${wallet.name} (Legacy Pool)` : wallet.name,
        status: wallet.status,
        openingBalance: wallet.openingBalance.toFixed(2),
        totalIn: (inByWallet.get(wallet.id) ?? new Prisma.Decimal(0)).toFixed(2),
        totalOut: (outByWallet.get(wallet.id) ?? new Prisma.Decimal(0)).toFixed(2),
        currentBalance: balance.toFixed(2),
      };
    });

    return {
      totalAccounts: wallets.length,
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

    const entry = await this.prisma.savingsGoalEntry.create({
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
    await this.maybeMarkCompleted(goal);
    return entry;
  }

  // A goal that reaches (or, via an over-contribution, passes) its
  // targetAmount is done -- flip it to COMPLETED right away rather than
  // leaving it sitting at "ACTIVE" until someone manually marks it, which
  // left fully-funded goals stuck under the Active tab (still earning an
  // "On Track" pace badge) instead of the Completed tab where they actually
  // belong. Never touches an already-COMPLETED or WITHDRAWN goal (WITHDRAWN
  // in particular must never be silently overwritten back to COMPLETED just
  // because computeCurrentAmount() would read as 0 vs. a since-lowered
  // target, or any other edge case -- withdraw() is a one-way transition).
  // Returns the goal with its corrected status (unchanged if nothing
  // needed fixing) so callers always compute against the true current
  // state, not a stale one -- toSummary() calls this on every read (not
  // just right after a contribution/transfer) specifically to self-heal
  // any goal that was already over target before this existed.
  private async maybeMarkCompleted(goal: SavingsGoal, currentAmount?: Prisma.Decimal): Promise<SavingsGoal> {
    if (goal.status === 'COMPLETED' || goal.status === 'WITHDRAWN') return goal;
    const amount = currentAmount ?? (await this.computeCurrentAmount(goal.id));
    if (amount.greaterThanOrEqualTo(goal.targetAmount)) {
      return this.prisma.savingsGoal.update({ where: { id: goal.id }, data: { status: 'COMPLETED' } });
    }
    return goal;
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
    const result = await this.prisma.$transaction([
      this.prisma.savingsGoalEntry.create({
        data: { savingsGoalId: fromGoal.id, businessId, type: 'TRANSFER_OUT', amount: dto.amount, date, relatedGoalId: toGoal.id, notes: dto.notes },
      }),
      this.prisma.savingsGoalEntry.create({
        data: { savingsGoalId: toGoal.id, businessId, type: 'TRANSFER_IN', amount: dto.amount, date, relatedGoalId: fromGoal.id, notes: dto.notes },
      }),
    ]);
    // Only the receiving side can newly reach its target from a transfer.
    await this.maybeMarkCompleted(toGoal);
    return result;
  }

  // "Cash out" a completed (or any) goal -- takes its ENTIRE current saved
  // amount out of a real Savings Wallet and records it as a real Expense,
  // via the same double-entry Transaction engine addContribution() uses
  // (mirrored: money leaves the Savings Wallet instead of landing in it).
  // Marks the goal WITHDRAWN so its Dashboard card stops showing a
  // misleading 100%-saved progress bar for money that's actually been
  // spent. No partial withdrawal yet -- see WithdrawSavingsGoalDto's
  // comment.
  async withdraw(businessId: string, goalId: string, dto: WithdrawSavingsGoalDto, userId: string) {
    const goal = await this.requireGoal(businessId, goalId);
    if (goal.status === 'WITHDRAWN') {
      throw new BadRequestException('This goal has already been withdrawn.');
    }
    const currentAmount = await this.computeCurrentAmount(goal.id);
    if (currentAmount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('This goal has no saved balance to withdraw.');
    }

    const savingsAccount = await this.requireSavingsAccount(businessId, dto.savingsAccountId);
    if (new Prisma.Decimal(savingsAccount.currentBalance).lessThan(currentAmount)) {
      throw new BadRequestException(
        `"${savingsAccount.name}" only has ${new Prisma.Decimal(savingsAccount.currentBalance).toFixed(2)} -- cannot withdraw ${currentAmount.toFixed(2)} from it. Pick a different Savings Wallet.`,
      );
    }
    const expenseAccount = await this.requireExpenseAccount(businessId, dto.expenseAccountId);

    const transaction = await this.transactionsService.createTransaction(
      businessId,
      {
        transactionType: 'EXPENSE',
        transactionDate: dto.date,
        description: dto.notes ? `Savings withdrawal: ${goal.name} -- ${dto.notes}` : `Savings withdrawal: ${goal.name}`,
        entries: [
          { accountId: expenseAccount.id, entryType: 'DEBIT', amount: currentAmount.toNumber(), categoryId: dto.categoryId, note: dto.notes },
          { accountId: savingsAccount.id, entryType: 'CREDIT', amount: currentAmount.toNumber() },
        ],
      },
      userId,
    );

    const [entry] = await this.prisma.$transaction([
      this.prisma.savingsGoalEntry.create({
        data: {
          savingsGoalId: goalId,
          businessId,
          type: 'WITHDRAWAL',
          amount: currentAmount,
          date: new Date(dto.date),
          savingsAccountId: savingsAccount.id,
          transactionId: transaction.id,
          notes: dto.notes,
        },
      }),
      this.prisma.savingsGoal.update({ where: { id: goalId }, data: { status: 'WITHDRAWN' } }),
    ]);

    return entry;
  }

  private async toSummary(goal: SavingsGoal) {
    const currentAmount = await this.computeCurrentAmount(goal.id);
    const target = new Prisma.Decimal(goal.targetAmount);
    // Self-healing, not just triggered on a fresh contribution/transfer --
    // catches a goal that was ALREADY fully funded before this check
    // existed (or any other way it slipped through) every time the list is
    // read, not only going forward. `goal` below is intentionally
    // reassigned to the corrected row so every downstream computation
    // (paceStatus, trend, the returned status itself) agrees with it.
    goal = await this.maybeMarkCompleted(goal, currentAmount);
    // Only ever non-zero once withdraw() has run (it always cashes out the
    // goal's ENTIRE saved amount at once) -- shown on the Dashboard card so
    // a WITHDRAWN goal's card still says how much was actually taken out,
    // since currentAmount itself is 0 again by then.
    const [withdrawnAgg, trend] = await Promise.all([
      this.prisma.savingsGoalEntry.aggregate({ where: { savingsGoalId: goal.id, type: 'WITHDRAWAL' }, _sum: { amount: true } }),
      this.computeTrend(goal),
    ]);
    const withdrawnAmount = new Prisma.Decimal(withdrawnAgg._sum.amount ?? 0);
    const progressPercent = target.isZero() ? 0 : Math.min(100, Math.round(currentAmount.dividedBy(target).times(100).toNumber()));
    return {
      ...goal,
      targetAmount: target.toFixed(2),
      currentAmount: currentAmount.toFixed(2),
      withdrawnAmount: withdrawnAmount.toFixed(2),
      progressPercent,
      monthlyTarget: target.dividedBy(goal.durationMonths).toFixed(2),
      paceStatus: this.computePaceStatus(goal, progressPercent),
      trend,
    };
  }

  // Time-aware "are you saving fast enough" signal for the Dashboard card --
  // ON_TRACK/BEHIND/WARNING only ever computed for an ACTIVE goal (a Paused/
  // Completed/Withdrawn goal isn't "supposed to" be gaining ground right
  // now, so the comparison is meaningless for those). Compares actual
  // progressPercent against where a perfectly even monthly pace WOULD have
  // it by now (elapsed months / durationMonths), using the exact same
  // targetAmount/durationMonths pacing this card's own "Monthly Savings"
  // figure is built from -- never a separate day-count ratio that could
  // disagree with it. A gap of 5 points either way is noise (rounding,
  // paying a contribution a few days late); past 25 points behind is a real
  // problem, not just "a little slow" -- deliberately no "ahead of pace"
  // penalty exists, since saving faster than planned is never a problem.
  private computePaceStatus(goal: SavingsGoal, progressPercent: number): 'ON_TRACK' | 'BEHIND' | 'WARNING' | null {
    if (goal.status !== 'ACTIVE') return null;
    if (progressPercent >= 100) return 'ON_TRACK';

    const elapsedMonths = (Date.now() - goal.createdAt.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
    if (elapsedMonths <= 0 || goal.durationMonths <= 0) return 'ON_TRACK';

    const expectedPercent = Math.min(100, (elapsedMonths / goal.durationMonths) * 100);
    const gap = progressPercent - expectedPercent;
    if (gap >= -5) return 'ON_TRACK';
    if (gap >= -25) return 'BEHIND';
    return 'WARNING';
  }

  // "Is the contribution habit itself improving, or trailing off" -- this
  // month's total CONTRIBUTION amount vs last month's, independent of
  // paceStatus (a goal can be behind pace overall but still trending up
  // month over month, which is worth showing separately). A >10% swing
  // either way counts as a real trend; smaller than that reads as STABLE
  // rather than flip-flopping on noise. No prior month to compare against
  // (a brand-new goal) reads as INCREASING the moment anything is
  // contributed, rather than a misleading DECREASING/STABLE with no basis.
  private async computeTrend(goal: SavingsGoal): Promise<'INCREASING' | 'DECREASING' | 'STABLE' | null> {
    if (goal.status !== 'ACTIVE') return null;

    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const [thisMonthAgg, lastMonthAgg] = await Promise.all([
      this.prisma.savingsGoalEntry.aggregate({
        where: { savingsGoalId: goal.id, type: 'CONTRIBUTION', date: { gte: thisMonthStart } },
        _sum: { amount: true },
      }),
      this.prisma.savingsGoalEntry.aggregate({
        where: { savingsGoalId: goal.id, type: 'CONTRIBUTION', date: { gte: lastMonthStart, lt: thisMonthStart } },
        _sum: { amount: true },
      }),
    ]);
    const thisMonth = new Prisma.Decimal(thisMonthAgg._sum.amount ?? 0);
    const lastMonth = new Prisma.Decimal(lastMonthAgg._sum.amount ?? 0);

    if (lastMonth.isZero()) return thisMonth.isZero() ? 'STABLE' : 'INCREASING';
    const change = thisMonth.minus(lastMonth).dividedBy(lastMonth);
    if (change.greaterThan(0.1)) return 'INCREASING';
    if (change.lessThan(-0.1)) return 'DECREASING';
    return 'STABLE';
  }

  private async computeCurrentAmount(goalId: string): Promise<Prisma.Decimal> {
    const grouped = await this.prisma.savingsGoalEntry.groupBy({ by: ['type'], where: { savingsGoalId: goalId }, _sum: { amount: true } });
    let total = new Prisma.Decimal(0);
    for (const row of grouped) {
      const amount = new Prisma.Decimal(row._sum.amount ?? 0);
      total = row.type === 'TRANSFER_OUT' || row.type === 'WITHDRAWAL' ? total.minus(amount) : total.plus(amount);
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
      throw new BadRequestException('Savings Wallet not found in this workspace');
    }
    if (account.accountType !== 'ASSET' || account.accountSubtype !== 'savings') {
      throw new BadRequestException('Must be a Savings Wallet -- add one first under Savings Goals > Wallet');
    }
    return account;
  }

  private async requireExpenseAccount(businessId: string, accountId: string): Promise<Account> {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account || account.businessId !== businessId) {
      throw new BadRequestException('expenseAccountId: account not found in this workspace');
    }
    if (account.accountType !== 'EXPENSE') {
      throw new BadRequestException('expenseAccountId must be an Expense account');
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
