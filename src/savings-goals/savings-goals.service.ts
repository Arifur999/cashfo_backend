import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Account, Prisma, SavingsGoal, SavingsGoalStatus } from '@prisma/client';
import { MONEY_ACCOUNT_SUBTYPES, SAVINGS_OPENING_ACCOUNT_SUBTYPE } from '../accounts/accounts.service.js';
import { dhakaDateKey, dhakaDateOnly, dhakaMonthRange } from '../common/dhaka.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TransactionsService } from '../transactions/transactions.service.js';
import { AddContributionDto } from './dto/add-contribution.dto.js';
import { AddProfitDto } from './dto/add-profit.dto.js';
import { CreateSavingsGoalDto } from './dto/create-savings-goal.dto.js';
import { CreateSavingsTransferDto } from './dto/create-savings-transfer.dto.js';
import { UpdateSavingsGoalDto } from './dto/update-savings-goal.dto.js';
import { UpdateSavingsGoalStatusDto } from './dto/update-savings-goal-status.dto.js';
import { UpdateSavingsPlanDto } from './dto/update-savings-plan.dto.js';
import { WithdrawSavingsGoalDto } from './dto/withdraw-savings-goal.dto.js';
import { WithdrawToBalanceDto } from './dto/withdraw-to-balance.dto.js';
import { GOAL_COLORS } from './goal-colors.js';
import { goalFromSnapshot, isGoalSnapshot, isPlanSnapshot, planFromSnapshot, toGoalSnapshot, toPlanSnapshot } from '../savings-plans/plan-snapshots.js';
import { entrySign, goalHoldings, splitLargestFirst, type HoldingEntry, type Holdings, type WalletPart } from './savings-holdings.js';
import { planPace } from './savings-plan.js';
import { renderStatementPdf, statementFileName, type StatementRowKind } from './savings-statement-pdf.js';

const ZERO = new Prisma.Decimal(0);

// The entry fields every read works from.
const ENTRY_SELECT = {
  id: true,
  savingsGoalId: true,
  type: true,
  amount: true,
  date: true,
  createdAt: true,
  moneyAccountId: true,
  savingsAccountId: true,
  relatedGoalId: true,
  transactionId: true,
  groupId: true,
  category: true,
  notes: true,
} satisfies Prisma.SavingsGoalEntrySelect;

type EntryRow = Prisma.SavingsGoalEntryGetPayload<{ select: typeof ENTRY_SELECT }>;

// A workspace's goal entries, read once per request, with what they add up
// to: each goal's money per savings wallet and the names of the accounts
// they name.
interface Ledger {
  entries: EntryRow[];
  holdings: Map<string, Holdings>;
  accountNames: Map<string, string>;
  // Account numbers, for the account a goal keeps its money in.
  accountNumbers: Map<string, string | null>;
}

const decimal = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const sum = (rows: { amount: Prisma.Decimal.Value }[]) => rows.reduce((total, row) => total.plus(row.amount), ZERO);
const dayOf = (date: Date) => date.toISOString().slice(0, 10);

@Injectable()
export class SavingsGoalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionsService: TransactionsService,
    private readonly mail: MailService,
  ) {}

  async list(businessId: string, status?: SavingsGoalStatus) {
    const [goals, ledger] = await Promise.all([
      this.prisma.savingsGoal.findMany({ where: { businessId, ...(status && { status }) }, orderBy: { createdAt: 'asc' } }),
      this.ledger(businessId),
    ]);
    return Promise.all(goals.map((goal) => this.toSummary(goal, ledger)));
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

    // This month on the Dhaka calendar -- the server clock is UTC, which is
    // still last month for the first six hours of every month here.
    const { start: monthStart, end: monthEnd } = dhakaMonthRange();

    const savedThisMonthAgg = await this.prisma.savingsGoalEntry.aggregate({
      _sum: { amount: true },
      where: { businessId, type: 'CONTRIBUTION', moneyAccountId: { not: null }, date: { gte: monthStart, lt: monthEnd } },
    });
    const savedThisMonth = savedThisMonthAgg._sum.amount ?? new Prisma.Decimal(0);

    // Same "categoryId != null picks exactly one side of the double-entry
    // pair" trick BudgetsService.listIncomeGoals() uses for "earned".
    const incomeThisMonthAgg = await this.prisma.transactionEntry.aggregate({
      _sum: { amount: true },
      where: {
        categoryId: { not: null },
        transaction: { businessId, status: 'POSTED', reversalOfId: null, transactionType: 'INCOME', transactionDate: { gte: monthStart, lt: monthEnd } },
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
      monthlyProgressPercent: monthlyTarget.isZero()
        ? 0
        : Math.min(999, Math.round(new Prisma.Decimal(savedThisMonth).dividedBy(monthlyTarget).times(100).toNumber())),
      savingsRatePercent: this.percent(savedThisMonth, incomeThisMonth),
      // What the rate is a share of, so the page can name it.
      incomeThisMonth: incomeThisMonth.toFixed(2),
    };
  }

  // Savings accounts' money summary -- same shape as
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
  // own status.
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
            // Voided transactions and their reversals net to zero; counted
            // gross they read as money that both came in and went out.
            where: { accountId: { in: walletIds }, transaction: { status: 'POSTED', reversalOfId: null } },
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
        accountNumber: wallet.accountNumber,
        // Its card colour (CARD_COLORS); null draws the colour of its place.
        color: wallet.color,
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

  // Which goals each savings wallet's money belongs to: for the Savings
  // accounts page's cards and their By goal tab. A goal counts in a wallet
  // while it holds money there; how many deposits made it, and which goals
  // moved money in, describe each line.
  async listWalletGoals(businessId: string) {
    const [goals, ledger] = await Promise.all([this.prisma.savingsGoal.findMany({ where: { businessId }, select: { id: true, name: true, status: true } }), this.ledger(businessId)]);
    const goalById = new Map(goals.map((goal) => [goal.id, goal]));
    const byWallet = new Map<string, { goalId: string; goalName: string; status: SavingsGoalStatus; amount: Prisma.Decimal; deposits: number; movedInFrom: string[] }[]>();

    for (const [goalId, holdings] of ledger.holdings) {
      const goal = goalById.get(goalId);
      if (!goal) continue;
      for (const [walletId, amount] of holdings) {
        if (!walletId || amount.lessThanOrEqualTo(0)) continue;
        const mine = ledger.entries.filter((e) => e.savingsGoalId === goalId && e.savingsAccountId === walletId);
        const movedInFrom = [
          ...new Set(
            mine
              .filter((e) => e.type === 'TRANSFER_IN' && e.relatedGoalId)
              .map((e) => goalById.get(e.relatedGoalId as string)?.name)
              .filter((name): name is string => !!name),
          ),
        ];
        const row = { goalId, goalName: goal.name, status: goal.status, amount, deposits: mine.filter((e) => e.type === 'CONTRIBUTION').length, movedInFrom };
        byWallet.set(walletId, [...(byWallet.get(walletId) ?? []), row]);
      }
    }

    return [...byWallet.entries()].map(([accountId, rows]) => ({
      accountId,
      goals: rows.sort((a, b) => b.amount.comparedTo(a.amount)).map((row) => ({ ...row, amount: row.amount.toFixed(2) })),
    }));
  }

  // One savings wallet's goal history, newest first: money added for a goal
  // (and from where), moves between goals that changed which goal its money
  // counts toward, goals that moved here or away with their money, and
  // withdrawals out of it.
  async listWalletHistory(businessId: string, accountId: string) {
    await this.requireSavingsAccount(businessId, accountId);
    const [goals, ledger] = await Promise.all([this.prisma.savingsGoal.findMany({ where: { businessId }, select: { id: true, name: true } }), this.ledger(businessId)]);
    const goalName = new Map(goals.map((goal) => [goal.id, goal.name]));
    const parts = this.entryParts(ledger.entries);

    const rows: {
      id: string;
      date: Date;
      kind: 'ALREADY_SAVED' | 'ADDED' | 'PROFIT' | 'MOVED' | 'WITHDRAWN' | 'ACCOUNT_IN' | 'ACCOUNT_OUT';
      goalName: string;
      otherGoalName: string | null;
      accountName: string | null;
      amount: string;
      notes: string | null;
    }[] = [];
    const seenGroups = new Set<string>();
    for (const entry of ledger.entries) {
      if (entry.type === 'ACCOUNT_CHANGE') {
        // A goal that changed account: its money left one wallet for the
        // other, listed once on each side (accountName: the other wallet).
        const away = entry.moneyAccountId === accountId;
        if (!away && entry.savingsAccountId !== accountId) continue;
        const moved = sum(parts.get(entry.id) ?? []);
        if (moved.lessThanOrEqualTo(0)) continue;
        const key = `${entry.groupId ?? entry.id}|${entry.type}|${away ? 'out' : 'in'}`;
        const row = rows.find((r) => r.id === key);
        if (row) {
          row.amount = decimal(row.amount).plus(moved).toFixed(2);
          continue;
        }
        const other = away ? entry.savingsAccountId : entry.moneyAccountId;
        rows.push({
          id: key,
          date: entry.date,
          kind: away ? 'ACCOUNT_OUT' : 'ACCOUNT_IN',
          goalName: goalName.get(entry.savingsGoalId) ?? '',
          otherGoalName: null,
          accountName: other ? (ledger.accountNames.get(other) ?? null) : null,
          amount: moved.toFixed(2),
          notes: entry.notes,
        });
        continue;
      }
      const here = (parts.get(entry.id) ?? []).filter((part) => part.walletId === accountId);
      if (here.length === 0 || entry.type === 'TRANSFER_IN') continue;
      const amount = sum(here);
      const name = goalName.get(entry.savingsGoalId) ?? '';
      if (entry.type === 'PROFIT') {
        // accountName: the income category it counts under.
        rows.push({ id: entry.id, date: entry.date, kind: 'PROFIT', goalName: name, otherGoalName: null, accountName: entry.category, amount: amount.toFixed(2), notes: entry.notes });
      } else if (entry.type === 'CONTRIBUTION') {
        rows.push({
          id: entry.id,
          date: entry.date,
          kind: entry.moneyAccountId ? 'ADDED' : 'ALREADY_SAVED',
          goalName: name,
          otherGoalName: null,
          accountName: entry.moneyAccountId ? (ledger.accountNames.get(entry.moneyAccountId) ?? null) : null,
          amount: amount.toFixed(2),
          notes: entry.notes,
        });
      } else {
        // A move or a withdrawal is listed once, though it may be several
        // entries (one per wallet): this wallet's part of it.
        const key = `${entry.groupId ?? entry.id}|${entry.type}`;
        if (seenGroups.has(key)) {
          const row = rows.find((r) => r.id === key);
          if (row) row.amount = decimal(row.amount).plus(amount).toFixed(2);
          continue;
        }
        seenGroups.add(key);
        rows.push({
          id: key,
          date: entry.date,
          kind: entry.type === 'TRANSFER_OUT' ? 'MOVED' : 'WITHDRAWN',
          goalName: name,
          otherGoalName: entry.relatedGoalId ? (goalName.get(entry.relatedGoalId) ?? null) : null,
          accountName: entry.moneyAccountId ? (ledger.accountNames.get(entry.moneyAccountId) ?? null) : null,
          amount: amount.toFixed(2),
          notes: entry.notes,
        });
      }
    }
    return rows.sort((a, b) => b.date.getTime() - a.date.getTime());
  }

  // Savings Transfer page's history: one row per move. A move that took
  // money from several savings wallets is several TRANSFER_OUT/TRANSFER_IN
  // pairs sharing a groupId, added up here; only a move with a groupId can
  // be undone (one so old it never got paired has none).
  async listTransfers(businessId: string) {
    const outEntries = await this.prisma.savingsGoalEntry.findMany({
      where: { businessId, type: 'TRANSFER_OUT' },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
    const goalIds = [...new Set(outEntries.flatMap((e) => [e.savingsGoalId, e.relatedGoalId].filter((v): v is string => !!v)))];
    const goals = goalIds.length ? await this.prisma.savingsGoal.findMany({ where: { id: { in: goalIds } } }) : [];
    const nameById = new Map(goals.map((g) => [g.id, g.name]));

    const rows = new Map<string, { id: string; groupId: string | null; date: Date; amount: Prisma.Decimal; fromGoalId: string; toGoalId: string | null; notes: string | null }>();
    for (const e of outEntries) {
      const key = e.groupId ?? e.id;
      const row = rows.get(key);
      if (row) row.amount = row.amount.plus(e.amount);
      else rows.set(key, { id: key, groupId: e.groupId, date: e.date, amount: decimal(e.amount), fromGoalId: e.savingsGoalId, toGoalId: e.relatedGoalId, notes: e.notes });
    }

    return [...rows.values()].map((row) => ({
      id: row.id,
      date: row.date,
      amount: row.amount.toFixed(2),
      fromGoalId: row.fromGoalId,
      fromGoalName: nameById.get(row.fromGoalId) ?? '(deleted goal)',
      toGoalId: row.toGoalId,
      toGoalName: row.toGoalId ? (nameById.get(row.toGoalId) ?? '(deleted goal)') : '(deleted goal)',
      notes: row.notes,
      canUndo: row.groupId !== null,
    }));
  }

  async getOne(businessId: string, id: string) {
    const goal = await this.requireGoal(businessId, id);
    const ledger = await this.ledger(businessId);
    const entries = ledger.entries.filter((e) => e.savingsGoalId === id).sort((a, b) => b.date.getTime() - a.date.getTime() || b.createdAt.getTime() - a.createdAt.getTime());

    const relatedGoalIds = [...new Set(entries.map((e) => e.relatedGoalId).filter((v): v is string => !!v))];
    const relatedGoals = relatedGoalIds.length ? await this.prisma.savingsGoal.findMany({ where: { id: { in: relatedGoalIds } } }) : [];
    const goalNameById = new Map(relatedGoals.map((g) => [g.id, g.name]));

    return {
      ...(await this.toSummary(goal, ledger)),
      entries: entries.map((e) => ({
        id: e.id,
        type: e.type,
        amount: e.amount.toFixed(2),
        date: e.date,
        moneyAccountName: e.moneyAccountId ? (ledger.accountNames.get(e.moneyAccountId) ?? null) : null,
        savingsAccountName: e.savingsAccountId ? (ledger.accountNames.get(e.savingsAccountId) ?? null) : null,
        relatedGoalName: e.relatedGoalId ? (goalNameById.get(e.relatedGoalId) ?? null) : null,
        groupId: e.groupId,
        category: e.category,
        notes: e.notes,
      })),
    };
  }

  // A goal's full statement, oldest first: every movement of its money with
  // where it came from and went, a running balance, the totals, where the
  // money came from altogether and which savings wallets hold it now. A
  // move or withdrawal across several wallets is one row.
  async getStatement(businessId: string, id: string) {
    const goal = await this.requireGoal(businessId, id);
    const ledger = await this.ledger(businessId);
    const summary = await this.toSummary(goal, ledger);
    const otherGoals = await this.prisma.savingsGoal.findMany({ where: { businessId }, select: { id: true, name: true } });
    const goalName = new Map(otherGoals.map((g) => [g.id, g.name]));
    const accountName = (accountId: string | null) => (accountId ? (ledger.accountNames.get(accountId) ?? null) : null);

    const entries = ledger.entries.filter((e) => e.savingsGoalId === id);
    const groups: EntryRow[][] = [];
    const byGroup = new Map<string, EntryRow[]>();
    for (const entry of entries) {
      if (!entry.groupId || entry.type === 'CONTRIBUTION' || entry.type === 'PROFIT') {
        groups.push([entry]);
        continue;
      }
      const key = `${entry.groupId}|${entry.type}`;
      const group = byGroup.get(key);
      if (group) group.push(entry);
      else {
        const fresh = [entry];
        byGroup.set(key, fresh);
        groups.push(fresh);
      }
    }
    const parts = this.entryParts(ledger.entries);
    const wallets = (group: EntryRow[]) => [...new Set(group.flatMap((e) => (parts.get(e.id) ?? []).map((p) => accountName(p.walletId) ?? '').filter(Boolean)))];

    let balance = ZERO;
    let moneyIn = ZERO;
    let moneyOut = ZERO;
    const sources = new Map<string, { kind: 'ACCOUNT' | 'ALREADY_SAVED' | 'GOAL' | 'PROFIT'; name: string | null; amount: Prisma.Decimal }>();
    const addSource = (kind: 'ACCOUNT' | 'ALREADY_SAVED' | 'GOAL' | 'PROFIT', name: string | null, amount: Prisma.Decimal) => {
      const key = `${kind}|${name ?? ''}`;
      const source = sources.get(key);
      if (source) source.amount = source.amount.plus(amount);
      else sources.set(key, { kind, name, amount });
    };

    const rows = groups
      .sort((a, b) => a[0].date.getTime() - b[0].date.getTime() || a[0].createdAt.getTime() - b[0].createdAt.getTime())
      .map((group) => {
        const first = group[0];
        const amount = sum(group);
        // An account change moves the money but leaves the balance as it is.
        if (first.type === 'ACCOUNT_CHANGE') {
          const left = [...new Set(group.map((e) => accountName(e.moneyAccountId)).filter((name): name is string => !!name))];
          return { date: first.date, kind: 'ACCOUNT_CHANGED' as StatementRowKind, from: left.join(', ') || null, to: accountName(first.savingsAccountId), notes: first.notes, moneyIn: null, moneyOut: null, balance: balance.toFixed(2), moved: amount.toFixed(2) };
        }
        if (first.type === 'PROFIT') {
          balance = balance.plus(amount);
          moneyIn = moneyIn.plus(amount);
          addSource('PROFIT', first.category, amount);
          // From: the income category; to: the savings wallet it was paid into.
          return { date: first.date, kind: 'PROFIT' as StatementRowKind, from: first.category, to: wallets(group).join(', ') || null, notes: first.notes, moneyIn: amount.toFixed(2), moneyOut: null, balance: balance.toFixed(2), moved: null };
        }
        const incoming = first.type === 'CONTRIBUTION' || first.type === 'TRANSFER_IN';
        balance = incoming ? balance.plus(amount) : balance.minus(amount);
        if (incoming) moneyIn = moneyIn.plus(amount);
        else moneyOut = moneyOut.plus(amount);
        const other = first.relatedGoalId ? (goalName.get(first.relatedGoalId) ?? null) : null;
        if (first.type === 'CONTRIBUTION') addSource(first.moneyAccountId ? 'ACCOUNT' : 'ALREADY_SAVED', accountName(first.moneyAccountId), amount);
        if (first.type === 'TRANSFER_IN') addSource('GOAL', other, amount);
        return {
          date: first.date,
          kind: (first.type === 'CONTRIBUTION' ? (first.moneyAccountId ? 'ADDED' : 'ALREADY_SAVED') : first.type === 'TRANSFER_IN' ? 'MOVED_IN' : first.type === 'TRANSFER_OUT' ? 'MOVED_OUT' : 'WITHDRAWN') as StatementRowKind,
          // Where the money came from and went: accounts, savings wallets
          // or the other goal, by name, as the kind says.
          from: first.type === 'CONTRIBUTION' ? accountName(first.moneyAccountId) : first.type === 'TRANSFER_IN' ? other : wallets(group).join(', ') || null,
          to: first.type === 'CONTRIBUTION' ? wallets(group).join(', ') || null : first.type === 'TRANSFER_OUT' ? other : first.type === 'WITHDRAWAL' ? accountName(first.moneyAccountId) : wallets(group).join(', ') || null,
          notes: first.notes,
          moneyIn: incoming ? amount.toFixed(2) : null,
          moneyOut: incoming ? null : amount.toFixed(2),
          balance: balance.toFixed(2),
          moved: null,
        };
      });

    const now = [...(ledger.holdings.get(id) ?? new Map<string, Prisma.Decimal>())]
      .filter(([, amount]) => amount.greaterThan(0))
      .sort((a, b) => b[1].comparedTo(a[1]))
      .map(([walletId, amount]) => ({ accountId: walletId || null, name: accountName(walletId), amount: amount.toFixed(2) }));

    return {
      goal: summary,
      today: dhakaDateKey(new Date()),
      rows,
      totals: { opening: '0.00', moneyIn: moneyIn.toFixed(2), moneyOut: moneyOut.toFixed(2), balance: balance.toFixed(2) },
      sources: [...sources.values()].map((source) => ({ ...source, amount: source.amount.toFixed(2) })),
      now,
    };
  }

  // The statement as a PDF to download, headed with the signed-in person.
  async statementPdf(businessId: string, id: string, userId: string): Promise<{ fileName: string; data: Buffer }> {
    const [statement, person, platformName] = await Promise.all([
      this.getStatement(businessId, id),
      this.prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
      this.mail.platformName(),
    ]);
    const { goal } = statement;
    const status = goal.status === 'ACTIVE' && goal.pace ? goal.pace.state : goal.status === 'WITHDRAWN' && goal.reachedAt ? 'ACHIEVED' : goal.status;
    const data = renderStatementPdf({
      platformName,
      person: { name: person?.name ?? '', email: person?.email ?? '' },
      goal: { name: goal.name, targetAmount: goal.targetAmount, targetDate: goal.targetDate, startDate: goal.startDate, status },
      today: statement.today,
      rows: statement.rows,
      totals: statement.totals,
      sources: statement.sources,
      now: statement.now,
    });
    return { fileName: statementFileName(goal.name, statement.today), data };
  }

  async create(businessId: string, dto: CreateSavingsGoalDto, userId: string) {
    const startAmount = decimal(dto.startAmount ?? 0);
    if (startAmount.greaterThan(dto.targetAmount)) {
      throw new BadRequestException("Already saved can't be more than the target.");
    }
    // The account it keeps its money in; what was already saved is there
    // too unless the request says where else.
    const keptIn = dto.accountId ?? dto.startAccountId ?? null;
    if (keptIn) await this.requireOpenSavingsAccount(businessId, keptIn);
    const today = dhakaDateOnly(new Date());
    const reached = startAmount.greaterThanOrEqualTo(dto.targetAmount);
    const data = {
      businessId,
      name: dto.name,
      targetAmount: dto.targetAmount,
      targetDate: new Date(dto.targetDate),
      durationMonths: dto.durationMonths,
      reminderDate: dto.reminderDate ? new Date(dto.reminderDate) : undefined,
      reminderChannel: dto.reminderDate ? (dto.reminderChannel ?? 'EMAIL') : dto.reminderChannel,
      description: dto.description,
      color: dto.color ?? null,
      startAmount,
      accountId: keptIn,
      ...(reached && { status: 'COMPLETED' as const, reachedAt: today }),
    };
    // Start goal on a saving plan: the plan goes in the same database
    // transaction, so it is never both a plan and a goal, and a second
    // start of the same plan finds it gone. The goal keeps the plan as it
    // was, for Undo (undoStart()).
    const claimPlan = async (tx: Prisma.TransactionClient): Promise<Prisma.InputJsonValue | undefined> => {
      if (!dto.fromPlanId) return undefined;
      const plan = await tx.savingsPlan.findUnique({ where: { id: dto.fromPlanId } });
      const { count } = plan && plan.businessId === businessId ? await tx.savingsPlan.deleteMany({ where: { id: plan.id, businessId } }) : { count: 0 };
      if (!plan || count === 0) throw new NotFoundException('That saving plan was not found. It may have been started already.');
      return toPlanSnapshot(plan) as unknown as Prisma.InputJsonValue;
    };
    if (startAmount.isZero()) {
      if (!dto.fromPlanId) return this.prisma.savingsGoal.create({ data });
      return this.prisma.$transaction(async (tx) => {
        const fromPlan = await claimPlan(tx);
        return tx.savingsGoal.create({ data: { ...data, fromPlan } });
      });
    }

    // The money already saved is recorded as the goal's first contribution,
    // into the savings wallet that holds it: a real posting, so the wallet's
    // balance shows it, against the workspace's hidden "saved before"
    // equity account (no cash account paid it in).
    const accountId = (dto.startAccountId ?? dto.accountId) as string;
    return this.transactionsService.withLocks([`account:${accountId}`], async (tx) => {
      const wallet = await this.requireSavingsAccount(businessId, accountId, tx);
      if (wallet.status !== 'ACTIVE') throw new BadRequestException('Pick a savings wallet that is not archived.');
      const fromPlan = await claimPlan(tx);
      const goal = await tx.savingsGoal.create({ data: { ...data, fromPlan } });
      const opening = await this.requireOrCreateOpeningAccount(businessId, tx);
      const transaction = await this.transactionsService.createTransaction(
        businessId,
        {
          transactionType: 'JOURNAL',
          transactionDate: dayOf(today),
          description: `Already saved: ${goal.name}`,
          entries: [
            { accountId: wallet.id, entryType: 'DEBIT', amount: startAmount.toNumber() },
            { accountId: opening.id, entryType: 'CREDIT', amount: startAmount.toNumber() },
          ],
        },
        userId,
        tx,
      );
      await tx.savingsGoalEntry.create({
        data: { savingsGoalId: goal.id, businessId, type: 'CONTRIBUTION', amount: startAmount, date: today, savingsAccountId: wallet.id, transactionId: transaction.id },
      });
      return goal;
    });
  }

  async update(businessId: string, id: string, dto: UpdateSavingsGoalDto, userId: string) {
    const existing = await this.requireGoal(businessId, id);
    // Another account to keep the money in: the next deposits go there, and
    // what is saved moves there too.
    if (dto.accountId !== undefined) await this.requireOpenSavingsAccount(businessId, dto.accountId);
    // A new reminder day gets its own email, also after an earlier one went.
    const newReminder = dto.reminderDate !== undefined && (dto.reminderDate ? new Date(dto.reminderDate).getTime() : null) !== (existing.reminderDate?.getTime() ?? null);
    const data: Prisma.SavingsGoalUncheckedUpdateInput = {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.targetAmount !== undefined && { targetAmount: dto.targetAmount }),
      ...(dto.targetDate !== undefined && { targetDate: new Date(dto.targetDate) }),
      ...(dto.durationMonths !== undefined && { durationMonths: dto.durationMonths }),
      ...(dto.reminderDate !== undefined && { reminderDate: dto.reminderDate ? new Date(dto.reminderDate) : null }),
      ...(dto.reminderChannel !== undefined && { reminderChannel: dto.reminderChannel }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.color !== undefined && { color: dto.color }),
      ...(dto.accountId !== undefined && { accountId: dto.accountId }),
      ...(newReminder && { reminderSentFor: null }),
    };
    const updated =
      dto.accountId !== undefined && dto.accountId !== existing.accountId
        ? await this.moveToAccount(businessId, existing.id, dto.accountId, data, userId)
        : await this.prisma.savingsGoal.update({ where: { id }, data });
    // A new target can finish the goal or give a finished one more to save.
    if (dto.targetAmount === undefined) return updated;
    return this.maybeReopen(await this.maybeMarkCompleted(updated));
  }

  // A goal that changes account takes its money along: one Transfer posting
  // moves what each other savings wallet holds for it into the new one (each
  // wallet's part an ACCOUNT_CHANGE entry, sharing a groupId), committed
  // with the goal's new account. Money whose wallet isn't known stays put.
  // The parts are worked out again under the locks, as a withdrawal's are.
  private async moveToAccount(businessId: string, goalId: string, accountId: string, data: Prisma.SavingsGoalUncheckedUpdateInput, userId: string): Promise<SavingsGoal> {
    const before = await this.ledger(businessId);
    const walletIds = [...(before.holdings.get(goalId)?.keys() ?? [])].filter((walletId) => walletId && walletId !== accountId);

    return this.transactionsService.withLocks([`savings-goal:${goalId}`, `account:${accountId}`, ...walletIds.map((walletId) => `account:${walletId}`)], async (tx) => {
      const goal = await this.requireGoal(businessId, goalId, tx);
      const ledger = await this.ledger(businessId, tx);
      const parts: WalletPart[] = [...(ledger.holdings.get(goalId) ?? new Map<string, Prisma.Decimal>())]
        .filter(([walletId, amount]) => walletId && walletId !== accountId && amount.greaterThan(0))
        .map(([walletId, amount]) => ({ walletId, amount }));
      if (parts.some((part) => !walletIds.includes(part.walletId))) throw new BadRequestException('The savings changed while this was saving. Try again.');

      if (parts.length > 0) {
        const to = await this.requireSavingsAccount(businessId, accountId, tx);
        for (const part of parts) {
          const wallet = await this.requireSavingsAccount(businessId, part.walletId, tx);
          if (decimal(wallet.currentBalance).lessThan(part.amount)) {
            throw new BadRequestException(`"${wallet.name}" only has ${decimal(wallet.currentBalance).toFixed(2)} -- cannot move ${part.amount.toFixed(2)} from it.`);
          }
        }
        const date = dhakaDateKey(new Date());
        const transaction = await this.transactionsService.createTransaction(
          businessId,
          {
            transactionType: 'TRANSFER',
            transactionDate: date,
            description: `Savings account change: ${goal.name} -- to ${to.name}`,
            entries: [
              { accountId: to.id, entryType: 'DEBIT', amount: sum(parts).toNumber() },
              ...parts.map((part) => ({ accountId: part.walletId, entryType: 'CREDIT' as const, amount: part.amount.toNumber() })),
            ],
          },
          userId,
          tx,
        );
        const groupId = randomUUID();
        for (const part of parts) {
          await tx.savingsGoalEntry.create({
            data: { savingsGoalId: goalId, businessId, type: 'ACCOUNT_CHANGE', amount: part.amount, date: new Date(date), moneyAccountId: part.walletId, savingsAccountId: to.id, transactionId: transaction.id, groupId },
          });
        }
      }
      return tx.savingsGoal.update({ where: { id: goalId }, data });
    });
  }

  async updateStatus(businessId: string, id: string, dto: UpdateSavingsGoalStatusDto) {
    const goal = await this.requireGoal(businessId, id);
    // Resuming starts a fresh plan from today and what is saved now: the
    // paused months don't count against it.
    const resuming = goal.status === 'PAUSED' && dto.status === 'ACTIVE';
    return this.prisma.savingsGoal.update({
      where: { id },
      data: { status: dto.status, ...(resuming && (await this.freshPlan(goal.id))) },
    });
  }

  // Catch up on a goal behind its plan (see UpdateSavingsPlanDto).
  async updatePlan(businessId: string, id: string, dto: UpdateSavingsPlanDto) {
    const goal = await this.requireGoal(businessId, id);
    if (goal.status !== 'ACTIVE') throw new BadRequestException('Only an active goal has a plan to catch up on.');
    const plan = await this.freshPlan(goal.id);
    if (dto.mode === 'RESET') {
      return this.prisma.savingsGoal.update({ where: { id }, data: { ...plan, monthlyReminder: true } });
    }
    const targetDate = new Date(dto.targetDate as string);
    if (dayOf(targetDate) <= dhakaDateKey(new Date())) throw new BadRequestException('Pick an end date after today.');
    return this.prisma.savingsGoal.update({
      where: { id },
      data: { ...plan, targetDate, durationMonths: Math.max(1, Math.min(1200, monthsBetween(dhakaDateKey(goal.createdAt), dayOf(targetDate)))) },
    });
  }

  // Hard-delete only when nothing has ever been contributed/transferred --
  // same "protect records with real activity" rule as
  // ContactsService.archive(). A goal with history is paused, withdrawn or
  // closed instead, so its record stays.
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
    const target = await this.requireGoal(businessId, goalId);
    const fromAccount = await this.requireMoneyAccount(businessId, dto.moneyAccountId);
    // Every deposit goes into the account the goal keeps its money in,
    // unless an older app names one.
    const toAccountId = dto.toAccountId ?? target.accountId;
    if (!toAccountId) throw new BadRequestException('Pick the savings account this money goes into.');
    const savingsAccount = await this.requireSavingsAccount(businessId, toAccountId);

    // The posting and the goal's entry commit together -- a failure between
    // them can no longer move the money without crediting the goal. The goal
    // is read under its lock: a withdrawal that finished while this waited
    // has closed it.
    const entry = await this.transactionsService.withLocks([`savings-goal:${goalId}`], async (tx) => {
      const goal = await this.requireGoal(businessId, goalId, tx);
      if (goal.status === 'WITHDRAWN') {
        throw new BadRequestException('This goal has been withdrawn -- add funds to another goal.');
      }
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
        tx,
      );
      // An older goal with no account yet keeps its money where this went.
      if (!goal.accountId) await tx.savingsGoal.update({ where: { id: goalId }, data: { accountId: savingsAccount.id } });

      return tx.savingsGoalEntry.create({
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
    });
    await this.maybeMarkCompleted(await this.requireGoal(businessId, goalId), undefined, entry.date);
    return entry;
  }

  // Profit the bank paid on the goal's savings: it lands in the account the
  // goal keeps its money in and counts as income under the category picked
  // (an INCOME posting, as Income & Expense makes one), with the goal's
  // PROFIT entry in the same database transaction. Nothing comes out of
  // the customer's own accounts.
  async addProfit(businessId: string, goalId: string, dto: AddProfitDto, userId: string) {
    const entry = await this.transactionsService.withLocks([`savings-goal:${goalId}`], async (tx) => {
      const goal = await this.requireGoal(businessId, goalId, tx);
      if (goal.status === 'WITHDRAWN') throw new BadRequestException('This goal has been withdrawn -- add profit to another goal.');
      if (!goal.accountId) throw new BadRequestException('Pick the savings account this goal keeps its money in first.');
      const wallet = await this.requireSavingsAccount(businessId, goal.accountId, tx);
      const income = await this.requireProfitIncomeAccount(businessId, tx);
      const transaction = await this.transactionsService.createTransaction(
        businessId,
        {
          transactionType: 'INCOME',
          transactionDate: dto.date,
          description: dto.notes ? `Profit on savings: ${goal.name} -- ${dto.notes}` : `Profit on savings: ${goal.name}`,
          entries: [
            { accountId: wallet.id, entryType: 'DEBIT', amount: dto.amount },
            { accountId: income.id, entryType: 'CREDIT', amount: dto.amount, categoryId: dto.category, note: dto.notes },
          ],
        },
        userId,
        tx,
      );
      return tx.savingsGoalEntry.create({
        data: {
          savingsGoalId: goalId,
          businessId,
          type: 'PROFIT',
          amount: dto.amount,
          date: new Date(dto.date),
          savingsAccountId: wallet.id,
          transactionId: transaction.id,
          category: dto.category,
          notes: dto.notes,
        },
      });
    });
    await this.maybeMarkCompleted(await this.requireGoal(businessId, goalId), undefined, entry.date);
    return entry;
  }

  // Move back to plans: a goal nothing has been recorded against yet goes
  // back to being a saving plan (its name, colour, target as the amount,
  // its end date and its note), in one database transaction.
  async moveToPlans(businessId: string, goalId: string) {
    return this.transactionsService.withLocks([`savings-goal:${goalId}`], async (tx) => {
      const goal = await this.requireGoal(businessId, goalId, tx);
      if (goal.status === 'WITHDRAWN') throw new BadRequestException('This goal has been withdrawn.');
      const entries = await tx.savingsGoalEntry.count({ where: { savingsGoalId: goalId } });
      if (entries > 0) throw new BadRequestException('Money has moved for this goal, so it stays a goal. Pause it instead.');
      const today = dhakaDateOnly(new Date());
      const dated = goal.targetDate.getTime() > today.getTime();
      const color = goal.color && (GOAL_COLORS as readonly string[]).includes(goal.color) ? goal.color : GOAL_COLORS[0];
      // A goal started from a plan goes back to that plan as it was; any
      // other becomes a plan from its own name, colour, target, date and note.
      const original = isPlanSnapshot(goal.fromPlan) ? planFromSnapshot(goal.fromPlan, businessId) : null;
      const plan = await tx.savingsPlan.create({
        data: {
          ...(original ?? {
            businessId,
            name: goal.name,
            category: 'others',
            color,
            amount: goal.targetAmount,
            horizon: dated ? 'BY_DATE' : 'SIX_MONTHS',
            needBy: dated ? goal.targetDate : null,
            priority: 'MEDIUM',
            note: goal.description || null,
            plannedOn: today,
          }),
          // The goal as it was, for Undo (backToGoal()).
          fromGoal: toGoalSnapshot(goal) as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.savingsGoal.delete({ where: { id: goalId } });
      return { planId: plan.id };
    });
  }

  // Undo of Start goal: the goal goes and its plan comes back as it was, in
  // one database transaction. Only while nothing but what was already saved
  // has been recorded on it: that opening posting is reversed (a real void,
  // so the savings account's balance is as it was), anything more and the
  // goal stays a goal.
  async undoStart(businessId: string, goalId: string, userId: string) {
    return this.transactionsService.withLocks([`savings-goal:${goalId}`], async (tx) => {
      const goal = await this.requireGoal(businessId, goalId, tx);
      if (!isPlanSnapshot(goal.fromPlan)) throw new BadRequestException('This goal was not started from a saving plan.');
      const entries = await tx.savingsGoalEntry.findMany({ where: { savingsGoalId: goalId } });
      if (entries.some((entry) => entry.type !== 'CONTRIBUTION' || entry.moneyAccountId !== null)) {
        throw new BadRequestException('Money has moved for this goal since it started, so it stays a goal.');
      }
      // The entry goes first: a void refuses a posting a goal still owns.
      for (const entry of entries) {
        await tx.savingsGoalEntry.delete({ where: { id: entry.id } });
        if (entry.transactionId) await this.transactionsService.voidTransaction(businessId, entry.transactionId, `Undo: ${goal.name} back to plans`, userId, tx);
      }
      const plan = await tx.savingsPlan.create({ data: planFromSnapshot(goal.fromPlan, businessId) });
      await tx.savingsGoal.delete({ where: { id: goalId } });
      return { planId: plan.id };
    });
  }

  // Undo of Move back to plans: the plan goes and the goal comes back as it
  // was, with its own id and start day, in one database transaction. Its
  // account comes back too unless that account has been deleted since.
  async backToGoal(businessId: string, planId: string) {
    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.savingsPlan.findUnique({ where: { id: planId } });
      if (!plan || plan.businessId !== businessId) throw new NotFoundException('That saving plan was not found. It may have been started or deleted.');
      if (!isGoalSnapshot(plan.fromGoal)) throw new BadRequestException('This plan was not moved back from a goal.');
      const snapshot = plan.fromGoal;
      const account = snapshot.accountId ? await tx.account.findUnique({ where: { id: snapshot.accountId }, select: { businessId: true } }) : null;
      const { count } = await tx.savingsPlan.deleteMany({ where: { id: planId, businessId } });
      if (count === 0) throw new NotFoundException('That saving plan was not found. It may have been started or deleted.');
      const goal = await tx.savingsGoal.create({ data: goalFromSnapshot(snapshot, businessId, account?.businessId === businessId) });
      return { goalId: goal.id };
    });
  }

  // A goal that reaches (or, via an over-contribution, passes) its
  // targetAmount is done -- flip it to COMPLETED right away rather than
  // leaving it sitting at "ACTIVE" until someone manually marks it, which
  // left fully-funded goals stuck under the Active tab (still earning an
  // "On Track" pace badge) instead of the Completed tab where they actually
  // belong. Never touches an already-COMPLETED or WITHDRAWN goal (WITHDRAWN
  // in particular must never be silently overwritten back to COMPLETED just
  // because computeCurrentAmount() would read as 0 vs. a since-lowered
  // target, or any other edge case -- a withdrawal is a one-way transition).
  // Returns the goal with its corrected status (unchanged if nothing
  // needed fixing) so callers always compute against the true current
  // state, not a stale one -- toSummary() calls this on every read (not
  // just right after a contribution/transfer) specifically to self-heal
  // any goal that was already over target before this existed. The day it
  // was reached is the money's day when known, else today.
  private async maybeMarkCompleted(goal: SavingsGoal, currentAmount?: Prisma.Decimal, reachedOn?: Date): Promise<SavingsGoal> {
    if (goal.status === 'COMPLETED' || goal.status === 'WITHDRAWN') return goal;
    const amount = currentAmount ?? (await this.computeCurrentAmount(goal.id));
    if (amount.greaterThanOrEqualTo(goal.targetAmount)) {
      // Conditional: a withdrawal that committed after `goal` was read
      // must never be turned back into COMPLETED.
      await this.prisma.savingsGoal.updateMany({
        where: { id: goal.id, status: { in: ['ACTIVE', 'PAUSED'] } },
        data: { status: 'COMPLETED', reachedAt: reachedOn ?? dhakaDateOnly(new Date()), monthlyReminder: false },
      });
      return this.prisma.savingsGoal.findUniqueOrThrow({ where: { id: goal.id } });
    }
    return goal;
  }

  // Internal reallocation between two goals -- the cash stays in its
  // savings wallets, so no real Transaction is created, just a matched
  // TRANSFER_OUT/TRANSFER_IN pair per wallet the money sits in (largest
  // holding first), sharing one groupId. Both goals are locked (the same
  // keys a withdrawal and addContribution() take), so two transfers out of
  // one goal can't both pass the balance check on the same money.
  async transfer(businessId: string, dto: CreateSavingsTransferDto) {
    if (dto.fromGoalId === dto.toGoalId) {
      throw new BadRequestException('Cannot transfer a goal to itself');
    }

    const { result, toGoal } = await this.transactionsService.withLocks([`savings-goal:${dto.fromGoalId}`, `savings-goal:${dto.toGoalId}`], async (tx) => {
      const fromGoal = await this.requireGoal(businessId, dto.fromGoalId, tx);
      const toGoal = await this.requireGoal(businessId, dto.toGoalId, tx);
      if (toGoal.status === 'WITHDRAWN') {
        throw new BadRequestException(`"${toGoal.name}" has been withdrawn -- pick another goal to move the money to.`);
      }

      const fromCurrent = await this.computeCurrentAmount(fromGoal.id, tx);
      const amount = decimal(dto.amount);
      if (fromCurrent.lessThan(amount)) {
        throw new BadRequestException(`"${fromGoal.name}" only has ${fromCurrent.toFixed(2)} saved -- cannot transfer ${amount.toFixed(2)}`);
      }

      const ledger = await this.ledger(businessId, tx);
      const parts = this.splitOrRest(ledger.holdings.get(fromGoal.id), amount);
      const groupId = randomUUID();
      const date = new Date(dto.date);
      const result = [];
      for (const part of parts) {
        const savingsAccountId = part.walletId || null;
        result.push(
          await tx.savingsGoalEntry.create({
            data: { savingsGoalId: fromGoal.id, businessId, type: 'TRANSFER_OUT', amount: part.amount, date, relatedGoalId: toGoal.id, savingsAccountId, groupId, notes: dto.notes },
          }),
          await tx.savingsGoalEntry.create({
            data: { savingsGoalId: toGoal.id, businessId, type: 'TRANSFER_IN', amount: part.amount, date, relatedGoalId: fromGoal.id, savingsAccountId, groupId, notes: dto.notes },
          }),
        );
      }
      return { result, toGoal };
    });
    // The receiving side can reach its target; the giving side, if it was
    // finished, has something to save again.
    await this.maybeMarkCompleted(toGoal, undefined, new Date(dto.date));
    await this.maybeReopen(await this.requireGoal(businessId, dto.fromGoalId), true);
    return result;
  }

  // Takes a move back: the money counts toward the goal it came from again.
  // Refused once the receiving goal has spent it (moved it on, withdrawn it).
  async undoTransfer(businessId: string, groupId: string) {
    const entries = await this.prisma.savingsGoalEntry.findMany({ where: { businessId, groupId, type: { in: ['TRANSFER_OUT', 'TRANSFER_IN'] } } });
    const out = entries.find((e) => e.type === 'TRANSFER_OUT');
    const into = entries.find((e) => e.type === 'TRANSFER_IN');
    if (!out || !into) throw new NotFoundException('Move not found');
    const amount = sum(entries.filter((e) => e.type === 'TRANSFER_IN'));

    await this.transactionsService.withLocks([`savings-goal:${out.savingsGoalId}`, `savings-goal:${into.savingsGoalId}`], async (tx) => {
      const toGoal = await this.requireGoal(businessId, into.savingsGoalId, tx);
      if (toGoal.status === 'WITHDRAWN') throw new BadRequestException(`"${toGoal.name}" has been withdrawn, so this move can't be undone.`);
      const held = await this.computeCurrentAmount(toGoal.id, tx);
      if (held.lessThan(amount)) throw new BadRequestException(`"${toGoal.name}" no longer has this money, so the move can't be undone.`);
      await tx.savingsGoalEntry.deleteMany({ where: { businessId, groupId } });
    });

    await this.maybeMarkCompleted(await this.requireGoal(businessId, out.savingsGoalId), undefined, out.date);
    await this.maybeReopen(await this.requireGoal(businessId, into.savingsGoalId), true);
    return { groupId };
  }

  // A COMPLETED goal back under its target -- its target raised, or money
  // moved or withdrawn -- is ACTIVE again, so it shows where saving
  // continues instead of staying "Completed" below 100%. Only after those
  // changes, never on a read: a goal the customer marked complete by hand
  // stays so. Conditional, so a withdrawal that committed meanwhile is
  // never turned back. When money left it (not a new target), its plan
  // starts afresh from today.
  private async maybeReopen(goal: SavingsGoal, freshPlan = false): Promise<SavingsGoal> {
    if (goal.status !== 'COMPLETED') return goal;
    const amount = await this.computeCurrentAmount(goal.id);
    if (amount.greaterThanOrEqualTo(goal.targetAmount)) return goal;
    await this.prisma.savingsGoal.updateMany({
      where: { id: goal.id, status: 'COMPLETED' },
      data: { status: 'ACTIVE', reachedAt: null, ...(freshPlan && { planStartDate: dhakaDateOnly(new Date()), planStartAmount: amount }) },
    });
    return this.prisma.savingsGoal.findUniqueOrThrow({ where: { id: goal.id } });
  }

  // Money out of a goal to a main balance account, any amount up to what is
  // saved. It leaves the savings wallets holding the goal's money, largest
  // first, in one Transfer posting; each wallet's part is its own
  // WITHDRAWAL entry, all sharing one groupId. Taking everything closes the
  // goal (Withdrawn, with reachedAt kept when it had reached its target);
  // taking part of a Completed goal opens it again with a fresh plan.
  async withdrawToBalance(businessId: string, goalId: string, dto: WithdrawToBalanceDto, userId: string) {
    const toAccount = await this.requireMoneyAccount(businessId, dto.toAccountId);
    // The wallets it may come out of, locked with the goal; the split is
    // worked out again under the lock.
    const before = await this.ledger(businessId);
    const walletIds = [...(before.holdings.get(goalId)?.keys() ?? [])].filter(Boolean);
    const amount = decimal(dto.amount);

    const entries = await this.transactionsService.withLocks([`savings-goal:${goalId}`, ...walletIds.map((walletId) => `account:${walletId}`)], async (tx) => {
      const goal = await this.requireGoal(businessId, goalId, tx);
      if (goal.status === 'WITHDRAWN') throw new BadRequestException('This goal has already been withdrawn.');
      const current = await this.computeCurrentAmount(goal.id, tx);
      if (current.lessThanOrEqualTo(0)) throw new BadRequestException('This goal has no saved balance to withdraw.');
      if (amount.greaterThan(current)) throw new BadRequestException(`"${goal.name}" only has ${current.toFixed(2)} saved -- cannot withdraw ${amount.toFixed(2)}`);

      const ledger = await this.ledger(businessId, tx);
      const parts = this.splitOrRest(ledger.holdings.get(goal.id), amount);
      if (parts.some((part) => !part.walletId)) throw new BadRequestException("Some of this goal's money isn't in a savings wallet the app knows. Move it to another goal first.");
      if (parts.some((part) => !walletIds.includes(part.walletId))) throw new BadRequestException('The savings changed while this was saving. Try again.');
      for (const part of parts) {
        const wallet = await this.requireSavingsAccount(businessId, part.walletId, tx);
        if (decimal(wallet.currentBalance).lessThan(part.amount)) {
          throw new BadRequestException(`"${wallet.name}" only has ${decimal(wallet.currentBalance).toFixed(2)} -- cannot withdraw ${part.amount.toFixed(2)} from it.`);
        }
      }

      const transaction = await this.transactionsService.createTransaction(
        businessId,
        {
          transactionType: 'TRANSFER',
          transactionDate: dto.date,
          description: dto.notes ? `Savings withdrawal: ${goal.name} -- ${dto.notes}` : `Savings withdrawal: ${goal.name}`,
          entries: [
            { accountId: toAccount.id, entryType: 'DEBIT', amount: amount.toNumber() },
            ...parts.map((part) => ({ accountId: part.walletId, entryType: 'CREDIT' as const, amount: part.amount.toNumber() })),
          ],
        },
        userId,
        tx,
      );

      const groupId = randomUUID();
      const created = [];
      for (const part of parts) {
        created.push(
          await tx.savingsGoalEntry.create({
            data: {
              savingsGoalId: goalId,
              businessId,
              type: 'WITHDRAWAL',
              amount: part.amount,
              date: new Date(dto.date),
              savingsAccountId: part.walletId,
              moneyAccountId: toAccount.id,
              transactionId: transaction.id,
              groupId,
              notes: dto.notes,
            },
          }),
        );
      }

      const left = current.minus(amount);
      if (left.isZero()) {
        await tx.savingsGoal.update({ where: { id: goalId }, data: { status: 'WITHDRAWN', monthlyReminder: false, ...(goal.status !== 'COMPLETED' && { reachedAt: null }) } });
      } else if (goal.status === 'COMPLETED') {
        await tx.savingsGoal.update({ where: { id: goalId }, data: { status: 'ACTIVE', reachedAt: null, planStartDate: dhakaDateOnly(new Date()), planStartAmount: left } });
      }
      return created;
    });
    return entries;
  }

  // The older "cash out" -- takes a goal's ENTIRE current saved amount out
  // of one Savings Wallet and records it as a real Expense. Kept for the
  // app versions that still send it; the app now withdraws to a main
  // balance account (withdrawToBalance()). Marks the goal WITHDRAWN.
  // Runs under the goal's (and the wallet's) lock, in one database
  // transaction: a second click waits for the first withdrawal to commit,
  // then sees WITHDRAWN and stops -- the savings are paid out once.
  async withdraw(businessId: string, goalId: string, dto: WithdrawSavingsGoalDto, userId: string) {
    return this.transactionsService.withLocks([`savings-goal:${goalId}`, `account:${dto.savingsAccountId}`], async (tx) => {
      const goal = await this.requireGoal(businessId, goalId, tx);
      if (goal.status === 'WITHDRAWN') {
        throw new BadRequestException('This goal has already been withdrawn.');
      }
      const currentAmount = await this.computeCurrentAmount(goal.id, tx);
      if (currentAmount.lessThanOrEqualTo(0)) {
        throw new BadRequestException('This goal has no saved balance to withdraw.');
      }

      const savingsAccount = await this.requireSavingsAccount(businessId, dto.savingsAccountId, tx);
      if (new Prisma.Decimal(savingsAccount.currentBalance).lessThan(currentAmount)) {
        throw new BadRequestException(
          `"${savingsAccount.name}" only has ${new Prisma.Decimal(savingsAccount.currentBalance).toFixed(2)} -- cannot withdraw ${currentAmount.toFixed(2)} from it. Pick a different Savings Wallet.`,
        );
      }
      const expenseAccount = await this.requireExpenseAccount(businessId, dto.expenseAccountId, tx);

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
        tx,
      );

      const entry = await tx.savingsGoalEntry.create({
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
      });
      await tx.savingsGoal.update({ where: { id: goalId }, data: { status: 'WITHDRAWN', monthlyReminder: false, ...(goal.status !== 'COMPLETED' && { reachedAt: null }) } });
      return entry;
    });
  }

  // Every entry of a workspace, its goals' holdings, and the account names
  // they need (the savings accounts' too, which a goal may keep its money in
  // before any deposit) -- one read, so a list of goals costs the same as one.
  private async ledger(businessId: string, client: Prisma.TransactionClient = this.prisma): Promise<Ledger> {
    const entries = await client.savingsGoalEntry.findMany({ where: { businessId }, select: ENTRY_SELECT });
    const accountIds = [...new Set(entries.flatMap((e) => [e.moneyAccountId, e.savingsAccountId]).filter((v): v is string => !!v))];
    const accounts = await client.account.findMany({
      where: { businessId, OR: [{ id: { in: accountIds } }, { accountType: 'ASSET', accountSubtype: 'savings' }] },
      select: { id: true, name: true, accountNumber: true },
    });
    return {
      entries,
      holdings: goalHoldings(entries as HoldingEntry[]),
      accountNames: new Map(accounts.map((a) => [a.id, a.name])),
      accountNumbers: new Map(accounts.map((a) => [a.id, a.accountNumber])),
    };
  }

  // Which wallets each entry's money was in: its own wallet, or for an old
  // move or withdrawal with none, the parts the replay gave it.
  private entryParts(entries: EntryRow[]): Map<string, WalletPart[]> {
    const parts = new Map<string, WalletPart[]>();
    goalHoldings(entries as HoldingEntry[], parts);
    return parts;
  }

  // `amount` split over a goal's holdings largest-first; whatever they don't
  // cover (a goal whose wallets aren't all known) is a part with no wallet.
  private splitOrRest(holdings: Holdings | undefined, amount: Prisma.Decimal): WalletPart[] {
    const parts = splitLargestFirst(holdings ?? new Map(), amount);
    const covered = sum(parts);
    return covered.lessThan(amount) ? [...parts, { walletId: '', amount: amount.minus(covered) }] : parts;
  }

  // A fresh plan line from today and what the goal holds now.
  private async freshPlan(goalId: string) {
    return { planStartDate: dhakaDateOnly(new Date()), planStartAmount: await this.computeCurrentAmount(goalId) };
  }

  private async toSummary(goal: SavingsGoal, ledger: Ledger) {
    const mine = ledger.entries.filter((e) => e.savingsGoalId === goal.id);
    const currentAmount = mine.reduce((total, e) => total.plus(new Prisma.Decimal(e.amount).times(entrySign(e.type))), ZERO);
    const target = new Prisma.Decimal(goal.targetAmount);
    // Self-healing, not just triggered on a fresh contribution/transfer --
    // catches a goal that was ALREADY fully funded before this check
    // existed (or any other way it slipped through) every time the list is
    // read, not only going forward. `goal` below is intentionally
    // reassigned to the corrected row so every downstream computation
    // (pace, trend, the returned status itself) agrees with it.
    goal = await this.maybeMarkCompleted(goal, currentAmount);

    const withdrawals = mine.filter((e) => e.type === 'WITHDRAWAL').sort((a, b) => b.date.getTime() - a.date.getTime());
    const withdrawnAmount = sum(withdrawals);
    // Profit the bank paid on it, all told.
    const profitTotal = sum(mine.filter((e) => e.type === 'PROFIT'));
    const { start: thisMonthStart, end: thisMonthEnd } = dhakaMonthRange();
    const { start: lastMonthStart } = dhakaMonthRange(-1);
    // Money added from an account; what was already saved when the goal was
    // made isn't saving done that month.
    const added = (from: Date, to: Date) => sum(mine.filter((e) => e.type === 'CONTRIBUTION' && e.moneyAccountId !== null && e.date >= from && e.date < to));
    const addedThisMonth = added(thisMonthStart, thisMonthEnd);
    const progressPercent = target.isZero() ? 0 : Math.min(100, Math.round(currentAmount.dividedBy(target).times(100).toNumber()));

    const today = dhakaDateKey(new Date());
    const planStartDate = goal.planStartDate ? dayOf(goal.planStartDate) : dhakaDateKey(goal.createdAt);
    const planStartAmount = decimal(goal.planStartAmount ?? goal.startAmount);
    const pace =
      goal.status === 'ACTIVE'
        ? planPace({ target: target.toNumber(), saved: currentAmount.toNumber(), planStart: planStartDate, planStartAmount: planStartAmount.toNumber(), end: dayOf(goal.targetDate), today })
        : null;

    const holdings = [...(ledger.holdings.get(goal.id) ?? new Map<string, Prisma.Decimal>())]
      .filter(([, amount]) => amount.greaterThan(0))
      .sort((a, b) => b[1].comparedTo(a[1]))
      .map(([walletId, amount]) => ({ accountId: walletId || null, name: walletId ? (ledger.accountNames.get(walletId) ?? null) : null, amount: amount.toFixed(2) }));
    const last = withdrawals[0];

    return {
      ...goal,
      targetAmount: target.toFixed(2),
      startAmount: decimal(goal.startAmount).toFixed(2),
      currentAmount: currentAmount.toFixed(2),
      withdrawnAmount: withdrawnAmount.toFixed(2),
      profitTotal: profitTotal.toFixed(2),
      progressPercent,
      monthlyTarget: target.dividedBy(goal.durationMonths).toFixed(2),
      // The day it began (Dhaka) and its plan line's start.
      startDate: dhakaDateKey(goal.createdAt),
      planStartDate,
      planStartAmount: planStartAmount.toFixed(2),
      pace: pace && { expected: pace.expected.toFixed(2), difference: pace.difference.toFixed(2), state: pace.state },
      // For the app versions that read the older field.
      paceStatus: pace ? (pace.state === 'BEHIND' ? ('BEHIND' as const) : ('ON_TRACK' as const)) : null,
      trend: goal.status === 'ACTIVE' ? this.trendOf(addedThisMonth, added(lastMonthStart, thisMonthStart)) : null,
      addedThisMonth: addedThisMonth.toFixed(2),
      entryCount: mine.length,
      holdings,
      // The savings account it keeps its money in (Keep the money in).
      account: goal.accountId ? { id: goal.accountId, name: ledger.accountNames.get(goal.accountId) ?? null, accountNumber: ledger.accountNumbers.get(goal.accountId) ?? null } : null,
      lastWithdrawal: last ? { date: last.date, accountName: last.moneyAccountId ? (ledger.accountNames.get(last.moneyAccountId) ?? null) : null } : null,
    };
  }

  // "Is the contribution habit itself improving, or trailing off" -- this
  // month's total CONTRIBUTION amount vs last month's, independent of the
  // pace (a goal can be behind its plan overall but still trending up month
  // over month, which is worth showing separately). A >10% swing either way
  // counts as a real trend; smaller than that reads as STABLE rather than
  // flip-flopping on noise. No prior month to compare against (a brand-new
  // goal) reads as INCREASING the moment anything is contributed, rather
  // than a misleading DECREASING/STABLE with no basis.
  private trendOf(thisMonth: Prisma.Decimal, lastMonth: Prisma.Decimal): 'INCREASING' | 'DECREASING' | 'STABLE' {
    if (lastMonth.isZero()) return thisMonth.isZero() ? 'STABLE' : 'INCREASING';
    const change = thisMonth.minus(lastMonth).dividedBy(lastMonth);
    if (change.greaterThan(0.1)) return 'INCREASING';
    if (change.lessThan(-0.1)) return 'DECREASING';
    return 'STABLE';
  }

  private async computeCurrentAmount(goalId: string, client: Prisma.TransactionClient = this.prisma): Promise<Prisma.Decimal> {
    const grouped = await client.savingsGoalEntry.groupBy({ by: ['type'], where: { savingsGoalId: goalId }, _sum: { amount: true } });
    let total = new Prisma.Decimal(0);
    for (const row of grouped) {
      const amount = new Prisma.Decimal(row._sum.amount ?? 0);
      total = total.plus(amount.times(entrySign(row.type)));
    }
    return total;
  }

  private percent(part: Prisma.Decimal.Value, whole: Prisma.Decimal.Value): number {
    const wholeDecimal = new Prisma.Decimal(whole);
    if (wholeDecimal.isZero()) return 0;
    return Math.min(999, Math.round(new Prisma.Decimal(part).dividedBy(wholeDecimal).times(100).toNumber()));
  }

  // The hidden equity account "Already saved" postings are made against:
  // money the goal held before it was recorded came from no cash account.
  private async requireOrCreateOpeningAccount(businessId: string, client: Prisma.TransactionClient): Promise<Account> {
    const existing = await client.account.findFirst({ where: { businessId, accountSubtype: SAVINGS_OPENING_ACCOUNT_SUBTYPE, isSystemAccount: true } });
    if (existing) return existing;
    return client.account.create({
      data: {
        businessId,
        name: 'Savings Brought In (Internal)',
        nameBn: 'আগের সঞ্চয় (অভ্যন্তরীণ)',
        accountType: 'EQUITY',
        accountSubtype: SAVINGS_OPENING_ACCOUNT_SUBTYPE,
        isSystemAccount: true,
        openingBalance: 0,
        currentBalance: 0,
      },
    });
  }

  // A savings account a goal can keep its money in: not archived.
  private async requireOpenSavingsAccount(businessId: string, accountId: string): Promise<Account> {
    const account = await this.requireSavingsAccount(businessId, accountId);
    if (account.status !== 'ACTIVE') throw new BadRequestException('Pick a savings account that is not archived.');
    return account;
  }

  private async requireSavingsAccount(businessId: string, accountId: string, client: Prisma.TransactionClient = this.prisma): Promise<Account> {
    const account = await client.account.findUnique({ where: { id: accountId } });
    if (!account || account.businessId !== businessId) {
      throw new BadRequestException('Savings Wallet not found in this workspace');
    }
    if (account.accountType !== 'ASSET' || account.accountSubtype !== 'savings') {
      throw new BadRequestException('Must be a Savings Wallet -- add one first under Savings Goals > Wallet');
    }
    return account;
  }

  private async requireExpenseAccount(businessId: string, accountId: string, client: Prisma.TransactionClient = this.prisma): Promise<Account> {
    const account = await client.account.findUnique({ where: { id: accountId } });
    if (!account || account.businessId !== businessId) {
      throw new BadRequestException('expenseAccountId: account not found in this workspace');
    }
    if (account.accountType !== 'EXPENSE') {
      throw new BadRequestException('expenseAccountId must be an Expense account');
    }
    return account;
  }

  private async requireMoneyAccount(businessId: string, accountId: string, client: Prisma.TransactionClient = this.prisma): Promise<Account> {
    const account = await client.account.findUnique({ where: { id: accountId } });
    if (!account || account.businessId !== businessId) {
      throw new BadRequestException('moneyAccountId: account not found in this workspace');
    }
    if (account.accountType !== 'ASSET' || !account.accountSubtype || !MONEY_ACCOUNT_SUBTYPES.includes(account.accountSubtype)) {
      throw new BadRequestException('moneyAccountId must be a cash/bank/mobile-money account');
    }
    return account;
  }

  // Where profit on savings is counted: an income account named for profit
  // or interest when the workspace has one, else its default income account
  // (the lowest display order, as Income & Expense picks it).
  private async requireProfitIncomeAccount(businessId: string, client: Prisma.TransactionClient): Promise<Account> {
    const accounts = await client.account.findMany({ where: { businessId, accountType: 'INCOME', status: 'ACTIVE' }, orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }] });
    const account = accounts.find((a) => /profit|interest/i.test(a.name)) ?? accounts[0];
    if (!account) throw new BadRequestException('Add an income category first, to count the profit under.');
    return account;
  }

  private async requireGoal(businessId: string, id: string, client: Prisma.TransactionClient = this.prisma) {
    const goal = await client.savingsGoal.findUnique({ where: { id } });
    if (!goal || goal.businessId !== businessId) {
      throw new NotFoundException('Savings goal not found');
    }
    return goal;
  }
}

// Whole calendar months from one day to another ('YYYY-MM-DD').
function monthsBetween(from: string, to: string): number {
  const months = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + (Number(to.slice(5, 7)) - Number(from.slice(5, 7)));
  return Number(to.slice(8, 10)) < Number(from.slice(8, 10)) ? months - 1 : months;
}
