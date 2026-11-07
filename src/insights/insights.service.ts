import { Injectable } from '@nestjs/common';
import { AiSection, Prisma } from '@prisma/client';
import { BudgetsService } from '../budgets/budgets.service.js';
import { dhakaDateKey } from '../common/dhaka.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ReceivablesPayablesService } from '../receivables-payables/receivables-payables.service.js';
import { ReportsService } from '../reports/reports.service.js';
import { SavingsGoalsService } from '../savings-goals/savings-goals.service.js';
import { UpdateAiSettingsDto } from './dto/ai-settings.dto.js';
import { affordAnswer, type BudgetFact, happenings, type IncomeFact, type InsightInputs, owedAnswer, shiftMonth, spendAnswer, summary, todos, ways } from './insights-rules.js';

const toPaisa = (value: string | number | Prisma.Decimal | null | undefined) => Math.round(Number(value ?? 0) * 100);
const monthStart = (key: string) => new Date(`${key}-01T00:00:00.000Z`);

// AI Insights for a workspace, worked out by rules from its own records
// (insights-rules.ts) -- no model reads them yet. A person turns it on and
// says which parts it may read; Password Manager is never read. The chat
// waits for a model (`chat: false`).
@Injectable()
export class InsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
    private readonly budgets: BudgetsService,
    private readonly savingsGoals: SavingsGoalsService,
    private readonly receivablesPayables: ReceivablesPayablesService,
  ) {}

  async settings(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { aiInsights: true, aiReads: true } });
    return { on: user.aiInsights, reads: user.aiReads };
  }

  async updateSettings(userId: string, dto: UpdateAiSettingsDto) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { ...(dto.on !== undefined && { aiInsights: dto.on }), ...(dto.reads !== undefined && { aiReads: { set: [...new Set(dto.reads)] } }) },
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
    const reads = { transactions: settings.reads.includes(AiSection.TRANSACTIONS), savings: settings.reads.includes(AiSection.SAVINGS), loans: settings.reads.includes(AiSection.LOANS) };
    const from = monthStart(shiftMonth(month, -6));
    const before = monthStart(shiftMonth(thisMonth, 1));
    const [year, monthNumber] = month.split('-').map(Number);

    const [expense, income, categories, budgetsNow, budgetsThen, goals, owed, biggestIncome] = await Promise.all([
      reads.transactions ? this.reports.categoryByMonth(businessId, 'EXPENSE', from, before) : [],
      reads.transactions ? this.reports.categoryByMonth(businessId, 'INCOME', from, before) : [],
      this.prisma.budgetCategory.findMany({ where: { businessId, type: 'EXPENSE' }, select: { name: true, icon: true } }),
      reads.transactions ? this.budgetFacts(businessId, {}) : [],
      reads.transactions ? this.budgetFacts(businessId, { year, month: monthNumber }) : [],
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

  private async budgetFacts(businessId: string, query: { year?: number; month?: number }): Promise<BudgetFact[]> {
    const overview = await this.budgets.getOverview(businessId, query);
    return overview.categories.map((category) => ({ name: category.name, limit: category.monthlyLimit === null ? null : toPaisa(category.monthlyLimit), spent: toPaisa(category.spent) }));
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
