import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { AiSection, Prisma } from '@prisma/client';
import { BudgetsService } from '../budgets/budgets.service.js';
import { dhakaDateKey } from '../common/dhaka.js';
import { HousekeepingScheduler } from '../housekeeping/housekeeping.scheduler.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PushService } from '../push/push.service.js';
import { ReceivablesPayablesService } from '../receivables-payables/receivables-payables.service.js';
import { ReportsService } from '../reports/reports.service.js';
import { SavingsGoalsService } from '../savings-goals/savings-goals.service.js';
import { UpdateAiSettingsDto } from './dto/ai-settings.dto.js';
import { morningDay, morningKey } from './insights-morning.js';
import {
  affordAnswer,
  type BudgetFact,
  happenings,
  type IncomeFact,
  type InsightInputs,
  owedAnswer,
  shiftMonth,
  spendAnswer,
  summary,
  todos,
  ways,
} from './insights-rules.js';

const FIVE_MINUTES = 5 * 60 * 1000;

// The bell row of a morning summary (UserNotification type INSIGHT).
export interface MorningData {
  count: number;
  // The first thing to do, as the page lists it.
  first: { kind: string; name: string } | null;
  url: string;
}

const toPaisa = (value: string | number | Prisma.Decimal | null | undefined) => Math.round(Number(value ?? 0) * 100);
const monthStart = (key: string) => new Date(`${key}-01T00:00:00.000Z`);

// AI Insights for a workspace, worked out by rules from its own records
// (insights-rules.ts) -- no model reads them yet. A person turns it on and
// says which parts it may read; Password Manager is never read. The chat
// waits for a model (`chat: false`). Those who ask get a morning summary
// in the bell from 7 AM.
@Injectable()
export class InsightsService implements OnModuleInit {
  private readonly logger = new Logger(InsightsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
    private readonly budgets: BudgetsService,
    private readonly savingsGoals: SavingsGoalsService,
    private readonly receivablesPayables: ReceivablesPayablesService,
    private readonly push: PushService,
    private readonly housekeeping: HousekeepingScheduler,
  ) {}

  onModuleInit() {
    this.housekeeping.register({ name: 'ai-morning', everyMs: FIVE_MINUTES, run: (now) => this.sendMorning(now) });
  }

  async settings(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { aiInsights: true, aiReads: true, aiMorning: true } });
    return { on: user.aiInsights, reads: user.aiReads, morning: user.aiMorning };
  }

  async updateSettings(userId: string, dto: UpdateAiSettingsDto) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.on !== undefined && { aiInsights: dto.on }),
        ...(dto.reads !== undefined && { aiReads: { set: [...new Set(dto.reads)] } }),
        ...(dto.morning !== undefined && { aiMorning: dto.morning }),
      },
    });
    return this.settings(userId);
  }

  // The page: the person's settings, and while it is on, the last whole
  // month's summary, what to do now, what happened, the ways to save and
  // the answers to the suggested questions.
  async overview(businessId: string, userId: string, now = new Date()) {
    const settings = await this.settings(userId);
    if (!settings.on) return { ...settings, chat: false, report: null };
    const today = dhakaDateKey(now);
    const thisMonth = today.slice(0, 7);
    const month = shiftMonth(thisMonth, -1);
    const reads = {
      transactions: settings.reads.includes(AiSection.TRANSACTIONS),
      savings: settings.reads.includes(AiSection.SAVINGS),
      loans: settings.reads.includes(AiSection.LOANS),
    };
    const budget = settings.reads.includes(AiSection.BUDGET);
    const from = monthStart(shiftMonth(month, -6));
    const before = monthStart(shiftMonth(thisMonth, 1));
    const [year, monthNumber] = month.split('-').map(Number);

    const [expense, income, categories, budgetsNow, budgetsThen, goals, owed, biggestIncome] = await Promise.all([
      reads.transactions ? this.reports.categoryByMonth(businessId, 'EXPENSE', from, before) : [],
      reads.transactions ? this.reports.categoryByMonth(businessId, 'INCOME', from, before) : [],
      this.prisma.budgetCategory.findMany({ where: { businessId, type: 'EXPENSE' }, select: { name: true, icon: true } }),
      // Budgets only with Settings › Data & privacy’s Budget ticked too.
      reads.transactions && budget ? this.budgetFacts(businessId, {}) : [],
      reads.transactions && budget ? this.budgetFacts(businessId, { year, month: monthNumber }) : [],
      reads.savings ? this.goalFacts(businessId, thisMonth) : [],
      reads.loans ? this.owedFacts(businessId) : [],
      reads.transactions ? this.biggestIncome(businessId, month) : null,
    ]);
    const inputs: InsightInputs = {
      today,
      expense,
      income,
      icons: new Map(categories.map((category) => [category.name, category.icon])),
      budgetsNow,
      budgetsThen,
      goals,
      owed,
      biggestIncome,
      reads,
    };
    return {
      ...settings,
      chat: false,
      report: {
        generatedAt: now.toISOString(),
        summary: summary(inputs, month),
        todos: todos(inputs),
        happened: happenings(inputs, month),
        ways: ways(inputs, month),
        answers: { spend: spendAnswer(inputs, month), afford: affordAnswer(inputs, month), owed: owedAnswer(inputs) },
      },
    };
  }

  // From 7 AM, one bell row per workspace and day for the owners who asked:
  // how many things need attention, and the first. Workspaces already done
  // today are skipped, so the summary is worked out once a day; only new
  // rows are pushed, and a push that fails is only logged.
  async sendMorning(now: Date) {
    const day = morningDay(now);
    if (!day) return;
    const workspaces = await this.prisma.business.findMany({
      where: { owner: { aiInsights: true, aiMorning: true, status: 'ACTIVE' } },
      select: { id: true, ownerId: true },
    });
    if (workspaces.length === 0) return;
    const done = await this.prisma.userNotification.findMany({ where: { key: { in: workspaces.map((w) => morningKey(w.id, day)) } }, select: { key: true } });
    const skip = new Set(done.map((row) => row.key));
    const rows: Prisma.UserNotificationCreateManyInput[] = [];
    for (const workspace of workspaces) {
      if (skip.has(morningKey(workspace.id, day))) continue;
      const page = await this.overview(workspace.id, workspace.ownerId, now);
      const todos = page.report?.todos ?? [];
      const data: MorningData = { count: todos.length, first: todos[0] ? { kind: todos[0].kind, name: todos[0].name } : null, url: '/ai-insights' };
      rows.push({
        userId: workspace.ownerId,
        businessId: workspace.id,
        type: 'INSIGHT',
        key: morningKey(workspace.id, day),
        data: data as unknown as Prisma.InputJsonObject,
      });
    }
    if (rows.length === 0) return;
    const inserted = await this.prisma.userNotification.createManyAndReturn({ data: rows, skipDuplicates: true, select: { userId: true, data: true } });
    try {
      await this.push.send(
        inserted.map((row) => {
          const { count } = row.data as unknown as MorningData;
          return {
            userId: row.userId,
            build: (locale: 'en' | 'bn') =>
              locale === 'bn'
                ? {
                    title: 'সকালের সারাংশ',
                    body: count ? `আজ ${count}টি বিষয়ে নজর দেওয়া দরকার।` : 'আজ নজর দেওয়ার মতো কিছু নেই।',
                    url: '/ai-insights',
                    tag: 'ai-morning',
                  }
                : {
                    title: 'Your morning summary',
                    body: count ? `${count} ${count === 1 ? 'thing needs' : 'things need'} your attention today.` : 'Nothing needs your attention today.',
                    url: '/ai-insights',
                    tag: 'ai-morning',
                  },
          };
        }),
      );
    } catch (error) {
      this.logger.warn(`Morning summary push failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async budgetFacts(businessId: string, query: { year?: number; month?: number }): Promise<BudgetFact[]> {
    const overview = await this.budgets.getOverview(businessId, query);
    return overview.categories.map((category) => ({
      name: category.name,
      limit: category.monthlyLimit === null ? null : toPaisa(category.monthlyLimit),
      spent: toPaisa(category.spent),
    }));
  }

  private async goalFacts(businessId: string, thisMonth: string) {
    const [goals, entries] = await Promise.all([
      this.savingsGoals.list(businessId, 'ACTIVE'),
      this.prisma.savingsGoalEntry.groupBy({
        by: ['savingsGoalId'],
        where: { businessId, type: 'CONTRIBUTION', date: { gte: monthStart(thisMonth), lt: monthStart(shiftMonth(thisMonth, 1)) } },
        _sum: { amount: true },
      }),
    ]);
    return goals.map((goal) => ({
      id: goal.id,
      name: goal.name,
      target: toPaisa(goal.targetAmount),
      saved: toPaisa(goal.currentAmount),
      targetDate: goal.targetDate ? dhakaDateKey(goal.targetDate) : null,
      behind: goal.paceStatus !== null && goal.paceStatus !== 'ON_TRACK',
      inThisMonth: toPaisa(entries.find((row) => row.savingsGoalId === goal.id)?._sum.amount ?? 0),
    }));
  }

  private async owedFacts(businessId: string) {
    const dashboard = await this.receivablesPayables.getLoanDashboard(businessId);
    return dashboard.rows
      .filter((row) => row.direction === 'PAWNA')
      .map((row) => ({ contactId: row.contactId, name: row.contactName, amount: toPaisa(row.currentBalance), lastDate: row.lastEntry?.date ?? null }));
  }

  // The month's biggest single income: its category, amount and day.
  private async biggestIncome(businessId: string, month: string): Promise<IncomeFact | null> {
    const rows = await this.prisma.$queryRaw<{ day: Date; category: string | null; amount: Prisma.Decimal | null }[]>`
      SELECT t."transactionDate" AS "day", MAX(e."categoryId") AS "category", SUM(e."amount") FILTER (WHERE e."entryType" = 'DEBIT') AS "amount"
      FROM "Transaction" t JOIN "TransactionEntry" e ON e."transactionId" = t."id"
      WHERE t."businessId" = ${businessId} AND t."status" = 'POSTED' AND t."reversalOfId" IS NULL AND t."transactionType" = 'INCOME'
        AND t."transactionDate" >= ${monthStart(month)} AND t."transactionDate" < ${monthStart(shiftMonth(month, 1))}
      GROUP BY t."id", t."transactionDate"
      ORDER BY "amount" DESC NULLS LAST
      LIMIT 1`;
    const top = rows[0];
    if (!top || !top.amount) return null;
    return { category: top.category ?? 'Income', amount: toPaisa(top.amount), date: top.day.toISOString().slice(0, 10) };
  }
}
