import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BudgetCategoryType, Prisma, TransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { BudgetQueryDto } from './dto/budget-query.dto.js';
import { CreateBudgetCategoryDto } from './dto/create-budget-category.dto.js';
import { CreateIncomeGoalDto } from './dto/create-income-goal.dto.js';
import { UpdateBudgetCategoryDto } from './dto/update-budget-category.dto.js';
import { UpdateBudgetTargetDto } from './dto/update-budget-target.dto.js';
import { UpdateIncomeGoalDto } from './dto/update-income-goal.dto.js';

// Which side of the ledger a category's "spent"/"earned" figure is summed
// against, and which Business column backs its "total target" -- the one
// thing that differs between Budget Planning (EXPENSE) and Income Planning
// (INCOME); everything else in this service is shared.
const TRANSACTION_TYPE_FOR: Record<BudgetCategoryType, TransactionType> = { EXPENSE: 'EXPENSE', INCOME: 'INCOME' };

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
    const now = new Date();
    const year = query.year ?? now.getFullYear();
    const month = query.month ?? now.getMonth() + 1;
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 1);

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
            transaction: { businessId, status: 'POSTED', transactionType: TRANSACTION_TYPE_FOR[type], transactionDate: { gte: monthStart, lt: monthEnd } },
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

  async updateTarget(businessId: string, dto: UpdateBudgetTargetDto) {
    return this.prisma.business.update({
      where: { id: businessId },
      data: { monthlyBudgetTarget: dto.monthlyBudgetTarget },
      select: { monthlyBudgetTarget: true },
    });
  }

  // "earned" is never stored -- summed live the same way a category's
  // "spent" is (see getOverview's comment), except here it's EVERY POSTED
  // income transaction's categorized entry for the business in that
  // row's month/year, regardless of which Income Category it's tagged
  // with -- categoryId != null picks exactly one side of each income
  // transaction's double-entry pair (the money-account side never carries
  // one), so this never double-counts.
  async listIncomeGoals(businessId: string) {
    const goals = await this.prisma.incomeGoal.findMany({
      where: { businessId },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });

    return Promise.all(
      goals.map(async (goal) => {
        const monthStart = new Date(goal.year, goal.month - 1, 1);
        const monthEnd = new Date(goal.year, goal.month, 1);
        const result = await this.prisma.transactionEntry.aggregate({
          _sum: { amount: true },
          where: {
            categoryId: { not: null },
            transaction: { businessId, status: 'POSTED', transactionType: 'INCOME', transactionDate: { gte: monthStart, lt: monthEnd } },
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

  private async requireIncomeGoal(businessId: string, id: string) {
    const goal = await this.prisma.incomeGoal.findUnique({ where: { id } });
    if (!goal || goal.businessId !== businessId) {
      throw new NotFoundException('Income goal not found');
    }
    return goal;
  }

  async createCategory(businessId: string, dto: CreateBudgetCategoryDto) {
    const type = dto.type ?? BudgetCategoryType.EXPENSE;
    if (type === BudgetCategoryType.EXPENSE && dto.monthlyLimit == null) {
      throw new BadRequestException('A monthly limit is required for expense categories');
    }

    const existing = await this.prisma.budgetCategory.findUnique({ where: { businessId_type_name: { businessId, type, name: dto.name } } });
    if (existing) {
      throw new ConflictException(`A ${type === 'INCOME' ? 'income' : 'budget'} category named "${dto.name}" already exists`);
    }
    const count = await this.prisma.budgetCategory.count({ where: { businessId, type } });
    return this.prisma.budgetCategory.create({
      data: {
        businessId,
        type,
        name: dto.name,
        icon: dto.icon,
        color: dto.color,
        // INCOME never has a per-category limit, regardless of what's sent
        // (see BudgetCategory.monthlyLimit's schema comment) -- there's
        // just the one Business.monthlyIncomeTarget instead.
        monthlyLimit: type === BudgetCategoryType.INCOME ? null : dto.monthlyLimit,
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

    return this.prisma.budgetCategory.update({
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
