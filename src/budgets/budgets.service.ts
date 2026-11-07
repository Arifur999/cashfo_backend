import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
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
import { BUILT_IN_CHARGE_CATEGORIES, isReservedCategoryName, seedStarterCategories, ZAKAT_CATEGORY } from './app-categories.js';

// Which side of the ledger a category's "spent"/"earned" figure is summed
// against, and which Business column backs its "total target" -- the one
// thing that differs between Budget Planning (EXPENSE) and Income Planning
// (INCOME); everything else in this service is shared.
const TRANSACTION_TYPE_FOR: Record<BudgetCategoryType, TransactionType> = { EXPENSE: 'EXPENSE', INCOME: 'INCOME' };

// A month's bounds at UTC midnight, the way @db.Date transaction dates are stored.
const monthBounds = (year: number, month: number) => ({ gte: new Date(Date.UTC(year, month - 1, 1)), lt: new Date(Date.UTC(year, month, 1)) });

const RESERVED_MESSAGE = 'That name is used by the app for Zakat or transfer fees';
const ZAKAT_KEPT_MESSAGE = 'The Zakat page keeps this category';
const isZakat = (category: { type: BudgetCategoryType; name: string }) => category.type === 'EXPENSE' && category.name === ZAKAT_CATEGORY;

// The first colour no category of the type uses yet, else the next in turn:
// a category made from just a name still gets its own dot.
export const nextCategoryColor = (used: string[]): string => {
  const free = BUDGET_CATEGORY_COLORS.find((color) => !used.includes(color));
  return free ?? BUDGET_CATEGORY_COLORS[used.length % BUDGET_CATEGORY_COLORS.length];
};

// An expense category the app files money under by itself (Zakat, Gifts),
// made the first time it is needed, after the workspace's own. Safe to run
// twice at once: the name is unique per workspace and type.
export async function ensureExpenseCategory(client: Prisma.TransactionClient | PrismaService, businessId: string, name: string, icon: string) {
  const exists = await client.budgetCategory.count({ where: { businessId, type: 'EXPENSE', name } });
  if (exists) return;
  const siblings = await client.budgetCategory.findMany({ where: { businessId, type: 'EXPENSE' }, select: { color: true } });
  await client.budgetCategory.createMany({
    data: [{ businessId, type: 'EXPENSE', name, icon, color: nextCategoryColor(siblings.map((s) => s.color)), displayOrder: siblings.length }],
    skipDuplicates: true,
  });
}

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
  // (by name, as entries carry it). Zakat's is marked `system` (the Zakat
  // page keeps it); the built-in charge categories in use, which have no
  // row of their own, come as `automatic` rows.
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
      system: isZakat(category) ? ('zakat' as const) : null,
    });
    const own = new Set(categories.filter((category) => category.type === 'EXPENSE').map((category) => category.name));
    return {
      income: categories.filter((category) => category.type === 'INCOME').map(rowOf),
      expense: categories.filter((category) => category.type === 'EXPENSE').map(rowOf),
      automatic: BUILT_IN_CHARGE_CATEGORIES.filter((name) => !own.has(name) && (expenseCounts.get(name) ?? 0) > 0).map((name) => ({
        type: 'EXPENSE' as const,
        name,
        kind: 'charges' as const,
        transactionCount: expenseCounts.get(name) ?? 0,
      })),
    };
  }

  // Category Set's "Add the usual ones": the starter categories the
  // workspace doesn't have yet (a workspace made before they were given).
  async addStarterCategories(businessId: string) {
    const business = await this.prisma.business.findUnique({ where: { id: businessId }, select: { type: true } });
    if (!business) throw new NotFoundException('Workspace not found');
    await seedStarterCategories(this.prisma, businessId, business.type);
    return this.listCategorySet(businessId);
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
    if (isReservedCategoryName(dto.name)) throw new BadRequestException(RESERVED_MESSAGE);

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
    if (isZakat(category)) throw new BadRequestException(ZAKAT_KEPT_MESSAGE);
    if (dto.name !== undefined && dto.name !== category.name && isReservedCategoryName(dto.name)) throw new BadRequestException(RESERVED_MESSAGE);

    // A category's type changes only while no transaction uses it: its
    // entries are filed under its name within one type.
    const type = dto.type ?? category.type;
    if (type !== category.type && (await this.useCount(businessId, category)) > 0) {
      throw new BadRequestException('Transactions use this category, so its type stays the same');
    }

    if (dto.name !== undefined || type !== category.type) {
      const name = dto.name ?? category.name;
      const clash = await this.prisma.budgetCategory.findUnique({
        where: { businessId_type_name: { businessId, type, name } },
      });
      if (clash && clash.id !== id) {
        throw new ConflictException(`A ${type === 'INCOME' ? 'income' : 'budget'} category named "${name}" already exists`);
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
          ...(type !== category.type && { type, ...(type === BudgetCategoryType.INCOME && { monthlyLimit: null }) }),
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

  // A category in use is deleted only by moving its transactions to
  // another category of its type first (all of them, voided ones too, so
  // none is left naming a category that is gone), in one database
  // transaction; an unused one simply goes.
  async deleteCategory(businessId: string, id: string, moveTo?: string) {
    const category = await this.requireCategory(businessId, id);
    if (isZakat(category)) throw new BadRequestException(ZAKAT_KEPT_MESSAGE);
    const inUse = (await this.useCount(businessId, category)) > 0;
    if (!inUse) {
      await this.prisma.budgetCategory.delete({ where: { id } });
      return { id, moved: 0 };
    }
    const word = category.type === 'INCOME' ? 'income' : 'expense';
    if (!moveTo) {
      const others = await this.prisma.budgetCategory.count({ where: { businessId, type: category.type, id: { not: id } } });
      throw new BadRequestException(others ? `Transactions use this category. Pick the ${word} category they move to.` : `This is the only ${word} category. Add another one first, then delete this.`);
    }
    const target = await this.prisma.budgetCategory.findUnique({ where: { id: moveTo } });
    if (!target || target.businessId !== businessId || target.type !== category.type || target.id === id) {
      throw new BadRequestException(`Pick another ${word} category to move them to`);
    }
    const moved = await this.prisma.$transaction(async (tx) => {
      const result = await tx.transactionEntry.updateMany({
        where: { categoryId: category.name, transaction: { businessId, transactionType: TRANSACTION_TYPE_FOR[category.type] } },
        data: { categoryId: target.name },
      });
      await tx.budgetCategory.delete({ where: { id } });
      return result.count;
    });
    return { id, moved };
  }

  // How many standing transactions file under a category.
  private useCount(businessId: string, category: { name: string; type: BudgetCategoryType }): Promise<number> {
    return this.prisma.transactionEntry.count({
      where: { categoryId: category.name, transaction: { businessId, status: 'POSTED', reversalOfId: null, transactionType: TRANSACTION_TYPE_FOR[category.type] } },
    });
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
