import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BudgetCategoryType, Prisma, TransactionType } from '@prisma/client';
import { dhakaToday } from '../common/dhaka.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BudgetQueryDto } from './dto/budget-query.dto.js';
import { CreateBudgetCategoryDto } from './dto/create-budget-category.dto.js';
import { CreateIncomeGoalDto } from './dto/create-income-goal.dto.js';
import { UpdateBudgetCategoryDto } from './dto/update-budget-category.dto.js';
import { UpdateBudgetTargetDto } from './dto/update-budget-target.dto.js';
import { UpdateIncomeGoalDto } from './dto/update-income-goal.dto.js';
import { SaveMonthlyPlanDto } from './dto/save-monthly-plan.dto.js';
import { BUDGET_CATEGORY_COLORS } from './budget-category-visuals.js';

// Which side of the ledger a category's "spent"/"earned" figure is summed
// against, and which Business column backs its "total target" -- the one
// thing that differs between Budget Planning (EXPENSE) and Income Planning
// (INCOME); everything else in this service is shared.
const TRANSACTION_TYPE_FOR: Record<BudgetCategoryType, TransactionType> = { EXPENSE: 'EXPENSE', INCOME: 'INCOME' };

// A month's bounds at UTC midnight, the way @db.Date transaction dates are stored.
const monthBounds = (year: number, month: number) => ({ gte: new Date(Date.UTC(year, month - 1, 1)), lt: new Date(Date.UTC(year, month, 1)) });

// The first colour no category of the type uses yet, else the next in turn:
// a category made from just a name still gets its own dot.
export const nextCategoryColor = (used: string[]): string => {
  const free = BUDGET_CATEGORY_COLORS.find((color) => !used.includes(color));
  return free ?? BUDGET_CATEGORY_COLORS[used.length % BUDGET_CATEGORY_COLORS.length];
};

@Injectable()
export class BudgetsService {
  constructor(private readonly prisma: PrismaService) {}

  // "spent"/"earned" is never stored -- it's summed live from this
  // category's own type of POSTED transaction whose entry categoryId (a
  // plain string, see TransactionEntry's schema comment) matches this
  // category's name, for whichever month/year is being viewed. Categories/
  // limits themselves aren't month-specific, only this figure is.
  async getOverview(businessId: string, query: BudgetQueryDto) {
    const type = query.type ?? BudgetCategoryType.EXPENSE;
    // This month on the Dhaka calendar unless one is asked for; bounds at
    // UTC midnight, the way @db.Date transaction dates are stored.
    const today = dhakaToday();
    const year = query.year ?? today.year;
    const month = query.month ?? today.month;
    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 1));

    const [business, categories] = await Promise.all([
      this.prisma.business.findUniqueOrThrow({
        where: { id: businessId },
        select: { monthlyBudgetTarget: true },
      }),
      this.prisma.budgetCategory.findMany({ where: { businessId, type }, orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }] }),
    ]);

    // One aggregate query per category rather than a single groupBy -- there
    // are realistically a handful of categories per workspace (this app's
    // scale, same tradeoff ContactsService.list() makes for currentBalance),
    // and this keeps the "which categories exist" list and "how much
    // moved against each" figure trivially easy to keep in sync.
    const categoriesWithAmount = await Promise.all(
      categories.map(async (category) => {
        const result = await this.prisma.transactionEntry.aggregate({
          _sum: { amount: true },
          where: {
            categoryId: category.name,
            transaction: {
              businessId,
              status: 'POSTED',
              reversalOfId: null,
              transactionType: TRANSACTION_TYPE_FOR[type],
              transactionDate: { gte: monthStart, lt: monthEnd },
            },
          },
        });
        const amount = result._sum.amount ?? new Prisma.Decimal(0);
        // INCOME categories have no per-category limit (see the schema
        // comment) -- only EXPENSE ones do, so percent/limit are meaningless
        // (0 / null) for INCOME rather than computed against anything.
        const limit = category.monthlyLimit != null ? new Prisma.Decimal(category.monthlyLimit) : null;
        return {
          ...category,
          monthlyLimit: limit?.toFixed(2) ?? null,
          spent: amount.toFixed(2),
          percent: !limit || limit.isZero() ? 0 : Math.min(999, Math.round(amount.dividedBy(limit).times(100).toNumber())),
        };
      }),
    );

    const allocated = categories.reduce((sum, c) => sum.plus(c.monthlyLimit ?? 0), new Prisma.Decimal(0));
    // INCOME has no overall "total" here -- that's IncomeGoal now (a
    // month-by-month history, its own page), not a single Business column.
    const totalBudget = type === BudgetCategoryType.EXPENSE ? (business.monthlyBudgetTarget?.toFixed(2) ?? null) : null;

    return {
      month,
      year,
      type,
      totalBudget,
      allocated: allocated.toFixed(2),
      categories: categoriesWithAmount,
    };
  }

  async listCategoryNames(businessId: string, type: BudgetCategoryType = BudgetCategoryType.EXPENSE) {
    return this.prisma.budgetCategory.findMany({
      where: { businessId, type },
      select: { id: true, name: true, icon: true, color: true },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  // null clears the target: getOverview() then answers totalBudget: null.
  async updateTarget(businessId: string, dto: UpdateBudgetTargetDto) {
    return this.prisma.business.update({
      where: { id: businessId },
      data: { monthlyBudgetTarget: dto.monthlyBudgetTarget },
      select: { monthlyBudgetTarget: true },
    });
  }

  // "earned" is never stored -- summed live: EVERY standing income
  // transaction of the business in that row's month/year, once each (its
  // debit side, as the Transactions summary counts it), whatever its
  // category or none.
  async listIncomeGoals(businessId: string) {
    const goals = await this.prisma.incomeGoal.findMany({
      where: { businessId },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });

    return Promise.all(
      goals.map(async (goal) => {
        const monthStart = new Date(Date.UTC(goal.year, goal.month - 1, 1));
        const monthEnd = new Date(Date.UTC(goal.year, goal.month, 1));
        const result = await this.prisma.transactionEntry.aggregate({
          _sum: { amount: true },
          where: {
            entryType: 'DEBIT',
            transaction: { businessId, status: 'POSTED', reversalOfId: null, transactionType: 'INCOME', transactionDate: { gte: monthStart, lt: monthEnd } },
          },
        });
        const earned = result._sum.amount ?? new Prisma.Decimal(0);
        const amount = new Prisma.Decimal(goal.amount);
        return {
          ...goal,
          amount: amount.toFixed(2),
          earned: earned.toFixed(2),
          percent: amount.isZero() ? 0 : Math.min(999, Math.round(earned.dividedBy(amount).times(100).toNumber())),
        };
      }),
    );
  }

  async createIncomeGoal(businessId: string, dto: CreateIncomeGoalDto) {
    const existing = await this.prisma.incomeGoal.findUnique({ where: { businessId_year_month: { businessId, year: dto.year, month: dto.month } } });
    if (existing) {
      throw new ConflictException(`A goal for ${dto.month}/${dto.year} already exists`);
    }
    return this.prisma.incomeGoal.create({
      data: { businessId, month: dto.month, year: dto.year, amount: dto.amount, notes: dto.notes },
    });
  }

  async updateIncomeGoal(businessId: string, id: string, dto: UpdateIncomeGoalDto) {
    const goal = await this.requireIncomeGoal(businessId, id);

    const nextMonth = dto.month ?? goal.month;
    const nextYear = dto.year ?? goal.year;
    if (dto.month !== undefined || dto.year !== undefined) {
      const clash = await this.prisma.incomeGoal.findUnique({
        where: { businessId_year_month: { businessId, year: nextYear, month: nextMonth } },
      });
      if (clash && clash.id !== id) {
        throw new ConflictException(`A goal for ${nextMonth}/${nextYear} already exists`);
      }
    }

    return this.prisma.incomeGoal.update({
      where: { id },
      data: {
        ...(dto.month !== undefined && { month: dto.month }),
        ...(dto.year !== undefined && { year: dto.year }),
        ...(dto.amount !== undefined && { amount: dto.amount }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });
  }

  async deleteIncomeGoal(businessId: string, id: string) {
    await this.requireIncomeGoal(businessId, id);
    await this.prisma.incomeGoal.delete({ where: { id } });
    return { id };
  }

  // ---- Budget Planning: a month's income target and expense budget ----

  // What came in and went out in a month: every standing income and
  // expense once (its debit side), with a category or without one -- the
  // same sum as earned above and as the Transactions figures.
  async monthTotals(businessId: string, year: number, month: number) {
    const sum = (transactionType: TransactionType) =>
      this.prisma.transactionEntry.aggregate({
        _sum: { amount: true },
        where: { entryType: 'DEBIT', transaction: { businessId, status: 'POSTED', reversalOfId: null, transactionType, transactionDate: monthBounds(year, month) } },
      });
    const [income, expense] = await Promise.all([sum('INCOME'), sum('EXPENSE')]);
    return { earned: (income._sum.amount ?? new Prisma.Decimal(0)).toFixed(2), spent: (expense._sum.amount ?? new Prisma.Decimal(0)).toFixed(2) };
  }

  // Every month with a plan, newest first, with what came in and went out.
  async listMonthlyPlans(businessId: string) {
    const plans = await this.prisma.incomeGoal.findMany({ where: { businessId }, orderBy: [{ year: 'desc' }, { month: 'desc' }] });
    return Promise.all(plans.map(async (plan) => ({ ...planOf(plan), ...(await this.monthTotals(businessId, plan.year, plan.month)) })));
  }

  // One month as the page shows it: its plan (null figures when none was
  // set) and what came in and went out.
  async getMonthlyPlan(businessId: string, year: number, month: number) {
    const plan = await this.prisma.incomeGoal.findUnique({ where: { businessId_year_month: { businessId, year, month } } });
    const figures = plan ? planOf(plan) : { id: null, month, year, incomeTarget: null, expenseBudget: null };
    return { ...figures, ...(await this.monthTotals(businessId, year, month)) };
  }

  // "Set monthly budget": makes the month's plan or replaces its figures.
  async saveMonthlyPlan(businessId: string, dto: SaveMonthlyPlanDto) {
    await this.prisma.incomeGoal.upsert({
      where: { businessId_year_month: { businessId, year: dto.year, month: dto.month } },
      create: { businessId, year: dto.year, month: dto.month, amount: dto.incomeTarget, expenseBudget: dto.expenseBudget },
      update: { amount: dto.incomeTarget, expenseBudget: dto.expenseBudget },
    });
    return this.getMonthlyPlan(businessId, dto.year, dto.month);
  }

  // ---- Category Set ----

  // Both kinds of category, each with how many live transactions use it
  // (by name, as entries carry it).
  async listCategorySet(businessId: string) {
    const [categories, incomeCounts, expenseCounts] = await Promise.all([
      this.prisma.budgetCategory.findMany({ where: { businessId }, orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }] }),
      this.categoryUse(businessId, 'INCOME'),
      this.categoryUse(businessId, 'EXPENSE'),
    ]);
    const used = { INCOME: incomeCounts, EXPENSE: expenseCounts };
    const rowOf = (category: (typeof categories)[number]) => ({
      id: category.id,
      type: category.type,
      name: category.name,
      icon: category.icon,
      color: category.color,
      monthlyLimit: category.monthlyLimit ? new Prisma.Decimal(category.monthlyLimit).toFixed(2) : null,
      transactionCount: used[category.type].get(category.name) ?? 0,
    });
    return {
      income: categories.filter((category) => category.type === 'INCOME').map(rowOf),
      expense: categories.filter((category) => category.type === 'EXPENSE').map(rowOf),
    };
  }

  // How many live transactions of a type name each category.
  private async categoryUse(businessId: string, transactionType: TransactionType): Promise<Map<string, number>> {
    const rows = await this.prisma.transactionEntry.groupBy({
      by: ['categoryId'],
      where: { categoryId: { not: null }, transaction: { businessId, status: 'POSTED', reversalOfId: null, transactionType } },
      _count: { _all: true },
    });
    return new Map(rows.filter((row) => row.categoryId !== null).map((row) => [row.categoryId as string, row._count._all]));
  }

  private async requireIncomeGoal(businessId: string, id: string) {
    const goal = await this.prisma.incomeGoal.findUnique({ where: { id } });
    if (!goal || goal.businessId !== businessId) {
      throw new NotFoundException('Income goal not found');
    }
    return goal;
  }

  // An expense category's monthly limit is optional now (Category Set asks
  // only for a type and a name; the month's budget is set as a whole), and a
  // colour left out is picked for it.
  async createCategory(businessId: string, dto: CreateBudgetCategoryDto) {
    const type = dto.type ?? BudgetCategoryType.EXPENSE;

    const existing = await this.prisma.budgetCategory.findUnique({ where: { businessId_type_name: { businessId, type, name: dto.name } } });
    if (existing) {
      throw new ConflictException(`A ${type === 'INCOME' ? 'income' : 'budget'} category named "${dto.name}" already exists`);
    }
    const siblings = await this.prisma.budgetCategory.findMany({ where: { businessId, type }, select: { color: true } });
    const count = siblings.length;
    const color = dto.color ?? nextCategoryColor(siblings.map((sibling) => sibling.color));
    return this.prisma.budgetCategory.create({
      data: {
        businessId,
        type,
        name: dto.name,
        icon: dto.icon,
        color,
        // INCOME never has a per-category limit, regardless of what's sent
        // (see BudgetCategory.monthlyLimit's schema comment) -- there's
        // just the one Business.monthlyIncomeTarget instead.
        monthlyLimit: type === BudgetCategoryType.INCOME ? null : (dto.monthlyLimit ?? null),
        displayOrder: count,
      },
    });
  }

  async updateCategory(businessId: string, id: string, dto: UpdateBudgetCategoryDto) {
    const category = await this.requireCategory(businessId, id);

    if (dto.name !== undefined) {
      const clash = await this.prisma.budgetCategory.findUnique({
        where: { businessId_type_name: { businessId, type: category.type, name: dto.name } },
      });
      if (clash && clash.id !== id) {
        throw new ConflictException(`A ${category.type === 'INCOME' ? 'income' : 'budget'} category named "${dto.name}" already exists`);
      }
    }

    // Entries name their category by its name (TransactionEntry.categoryId
    // is a plain string), so a rename carries this workspace's entries of
    // the category's type along -- otherwise its spent/earned history read
    // as 0 and reports showed the old name as a separate category.
    return this.prisma.$transaction(async (tx) => {
      if (dto.name !== undefined && dto.name !== category.name) {
        await tx.transactionEntry.updateMany({
          where: { categoryId: category.name, transaction: { businessId, transactionType: TRANSACTION_TYPE_FOR[category.type] } },
          data: { categoryId: dto.name },
        });
      }
      return tx.budgetCategory.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.icon !== undefined && { icon: dto.icon }),
          ...(dto.color !== undefined && { color: dto.color }),
          // INCOME categories never get a limit -- see createCategory's
          // comment. Silently ignored here rather than rejected: a stray
          // limit on an update body is harmless to just drop.
          ...(dto.monthlyLimit !== undefined && category.type === BudgetCategoryType.EXPENSE && { monthlyLimit: dto.monthlyLimit }),
        },
      });
    });
  }

  async deleteCategory(businessId: string, id: string) {
    await this.requireCategory(businessId, id);
    await this.prisma.budgetCategory.delete({ where: { id } });
    return { id };
  }

  private async requireCategory(businessId: string, id: string) {
    const category = await this.prisma.budgetCategory.findUnique({ where: { id } });
    if (!category || category.businessId !== businessId) {
      throw new NotFoundException('Budget category not found');
    }
    return category;
  }
}

// A plan's own figures, as the page reads them.
function planOf(plan: { id: string; month: number; year: number; amount: Prisma.Decimal; expenseBudget: Prisma.Decimal | null }) {
  return {
    id: plan.id as string | null,
    month: plan.month,
    year: plan.year,
    incomeTarget: new Prisma.Decimal(plan.amount).toFixed(2) as string | null,
    expenseBudget: plan.expenseBudget ? new Prisma.Decimal(plan.expenseBudget).toFixed(2) : null,
  };
}
