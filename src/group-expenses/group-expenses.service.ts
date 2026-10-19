import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { GroupContributionKind, GroupMemberStatus, GroupSplit, Prisma } from '@prisma/client';
import { dhakaDateOnly, dhakaToday } from '../common/dhaka.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CloseSettlementDto } from './dto/close-settlement.dto.js';
import { CreateGroupContributionDto } from './dto/create-group-contribution.dto.js';
import { CreateGroupExpenseCategoryDto } from './dto/create-group-expense-category.dto.js';
import { CreateGroupExpenseDto } from './dto/create-group-expense.dto.js';
import { CreateGroupMemberDto } from './dto/create-group-member.dto.js';
import { CreateGroupMonthBudgetDto } from './dto/create-group-month-budget.dto.js';
import { UpdateGroupContributionDto } from './dto/update-group-contribution.dto.js';
import { UpdateGroupExpenseCategoryDto } from './dto/update-group-expense-category.dto.js';
import { UpdateGroupExpenseDto } from './dto/update-group-expense.dto.js';
import { UpdateGroupMemberDto } from './dto/update-group-member.dto.js';
import { UpdateGroupMonthBudgetDto } from './dto/update-group-month-budget.dto.js';
import { GroupExpenseSplitDto } from './dto/group-expense-split.dto.js';
import { SetGroupMealsDto } from './dto/group-meal.dto.js';
import { UpdateGroupSettingsDto } from './dto/group-settings.dto.js';
import { settleGroup } from './group-settlement.js';

export interface SettlementMemberRow {
  groupMemberId: string;
  name: string;
  // Gross deposits only (excludes returns) -- what the member actually
  // handed over. `contributed` stays the NET figure (deposits - returned)
  // since that's what closeSettlement() persists onto GroupSettlementMember
  // and what `balance` is computed from; grossDeposited/returned are
  // purely for the live breakdown display, not persisted.
  grossDeposited: string;
  returned: string;
  contributed: string;
  // Whether they shared the period's costs (in the group during it).
  sharing: boolean;
  // Paid from their own pocket, credited to them.
  pocketPaid: string;
  mealUnits: string;
  mealCost: string;
  // Their share of the costs not shared by meals.
  otherShare: string;
  // mealCost + otherShare.
  share: string;
  balance: string;
}

export interface SettlementResult {
  periodStart: Date;
  periodEnd: Date;
  totalExpense: string;
  memberCount: number;
  perMemberShare: string;
  // What meals shared, over how many meal units, at what rate.
  mealExpense: string;
  mealUnits: string;
  mealRate: string;
  // Contributions less the expenses paid from the fund: every balance added up.
  cashInHand: string;
  members: SettlementMemberRow[];
}

// A group's settings before any are saved.
const DEFAULT_SETTINGS = { kind: 'FAMILY' as const, monthStartDay: 1, cashHolderMemberId: null, mealsOn: false, breakfastUnits: '0.50', lunchUnits: '1.00', dinnerUnits: '1.00' };

const DAY_MS = 24 * 60 * 60 * 1000;
const dayKey = (date: Date) => date.toISOString().slice(0, 10);
// undefined leaves a date as it is; null clears it.
const dateOrNull = (value: string | null | undefined) => (value === undefined ? undefined : value === null ? null : new Date(value));
const paisa = (value: string | number | Prisma.Decimal) => Math.round(Number(value) * 100);

@Injectable()
export class GroupExpensesService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Members ----

  listMembers(businessId: string, status?: GroupMemberStatus) {
    return this.prisma.groupMember.findMany({
      where: { businessId, ...(status && { status }) },
      orderBy: { createdAt: 'asc' },
    });
  }

  createMember(businessId: string, dto: CreateGroupMemberDto) {
    return this.prisma.groupMember.create({
      data: { businessId, name: dto.name, phone: dto.phone, photoUrl: dto.photoUrl, shareUnits: dto.shareUnits, joinedOn: dateOrNull(dto.joinedOn) },
    });
  }

  // Archiving someone records today as the day they left (unless the edit
  // says), so they still share this month's costs up to it; bringing them
  // back clears it.
  async updateMember(businessId: string, id: string, dto: UpdateGroupMemberDto) {
    const current = await this.requireMember(businessId, id);
    const archiving = dto.status === 'ARCHIVED' && current.status === 'ACTIVE';
    const leftOn = dto.leftOn !== undefined ? dateOrNull(dto.leftOn) : archiving && !current.leftOn ? dhakaDateOnly(new Date()) : dto.status === 'ACTIVE' ? null : undefined;
    const joinedOn = dateOrNull(dto.joinedOn);
    const joined = joinedOn !== undefined ? joinedOn : current.joinedOn;
    const left = leftOn !== undefined ? leftOn : current.leftOn;
    if (joined && left && left < joined) {
      throw new BadRequestException("Someone can't leave before they joined");
    }
    return this.prisma.groupMember.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.photoUrl !== undefined && { photoUrl: dto.photoUrl }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.shareUnits !== undefined && { shareUnits: dto.shareUnits }),
        ...(joinedOn !== undefined && { joinedOn }),
        ...(leftOn !== undefined && { leftOn }),
      },
    });
  }

  // Same delete-or-archive shape as ContactsService.delete(): hard-delete
  // only if this member was never actually used anywhere; otherwise archive
  // so historical settlement rows keep pointing at a real member.
  async deleteMember(businessId: string, id: string): Promise<{ id: string; action: 'deleted' | 'archived' }> {
    await this.requireMember(businessId, id);

    const [contributionCount, expenseCount, settlementCount, splitCount, mealCount] = await Promise.all([
      this.prisma.groupContribution.count({ where: { groupMemberId: id } }),
      this.prisma.groupExpense.count({ where: { paidByMemberId: id } }),
      this.prisma.groupSettlementMember.count({ where: { groupMemberId: id } }),
      this.prisma.groupExpenseSplit.count({ where: { groupMemberId: id } }),
      this.prisma.groupMeal.count({ where: { groupMemberId: id } }),
    ]);

    if (contributionCount === 0 && expenseCount === 0 && settlementCount === 0 && splitCount === 0 && mealCount === 0) {
      await this.prisma.groupMember.delete({ where: { id } });
      return { id, action: 'deleted' };
    }

    const member = await this.requireMember(businessId, id);
    await this.prisma.groupMember.update({ where: { id }, data: { status: 'ARCHIVED', ...(!member.leftOn && { leftOn: dhakaDateOnly(new Date()) }) } });
    return { id, action: 'archived' };
  }

  // ---- Contributions ----

  listContributions(businessId: string, filters: { groupMemberId?: string; from?: string; to?: string }) {
    const where: Prisma.GroupContributionWhereInput = { businessId };
    if (filters.groupMemberId) where.groupMemberId = filters.groupMemberId;
    if (filters.from || filters.to) {
      where.date = {
        ...(filters.from && { gte: new Date(filters.from) }),
        ...(filters.to && { lte: new Date(filters.to) }),
      };
    }
    return this.prisma.groupContribution.findMany({
      where,
      include: { groupMember: true },
      // Same-date entries (common -- several contributions logged the same
      // day) break ties by most-recently-created first, so a correction
      // entry (e.g. a "Return Money" added right after the original
      // deposit) shows up above it instead of wherever date-only ordering
      // happens to place equal dates.
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async createContribution(businessId: string, dto: CreateGroupContributionDto) {
    await this.requireMember(businessId, dto.groupMemberId);
    return this.prisma.groupContribution.create({
      data: {
        businessId,
        groupMemberId: dto.groupMemberId,
        amount: dto.amount,
        kind: dto.kind ?? (Number(dto.amount) < 0 ? 'RETURN' : 'DEPOSIT'),
        date: new Date(dto.date),
        note: dto.note,
      },
    });
  }

  async updateContribution(businessId: string, id: string, dto: UpdateGroupContributionDto) {
    const current = await this.requireContribution(businessId, id);
    // A new amount on a deposit or a return says which it now is.
    const kind: GroupContributionKind | undefined = dto.kind ?? (dto.amount !== undefined && (current.kind === 'DEPOSIT' || current.kind === 'RETURN') ? (Number(dto.amount) < 0 ? 'RETURN' : 'DEPOSIT') : undefined);
    if (dto.groupMemberId) {
      await this.requireMember(businessId, dto.groupMemberId);
    }
    return this.prisma.groupContribution.update({
      where: { id },
      data: {
        ...(dto.groupMemberId !== undefined && { groupMemberId: dto.groupMemberId }),
        ...(dto.amount !== undefined && { amount: dto.amount }),
        ...(kind !== undefined && { kind }),
        ...(dto.date !== undefined && { date: new Date(dto.date) }),
        ...(dto.note !== undefined && { note: dto.note }),
      },
      include: { groupMember: true },
    });
  }

  async deleteContribution(businessId: string, id: string) {
    await this.requireContribution(businessId, id);
    await this.prisma.groupContribution.delete({ where: { id } });
    return { success: true };
  }

  // ---- Expense categories ----

  private readonly DEFAULT_EXPENSE_CATEGORIES: { name: string; icon: string; color: string }[] = [
    { name: 'Grocery / Bazar', icon: 'shopping-cart', color: 'green' },
    { name: 'Rent', icon: 'house', color: 'blue' },
    { name: 'Utility', icon: 'plug', color: 'orange' },
    { name: 'Other', icon: 'package', color: 'indigo' },
  ];

  // Lazily seeds the 4 defaults the first time a business's category list is
  // ever requested -- same pattern as AssetsService.listCategories().
  async listExpenseCategories(businessId: string) {
    const existing = await this.prisma.groupExpenseCategoryOption.findMany({ where: { businessId }, orderBy: { displayOrder: 'asc' } });
    if (existing.length > 0) return existing;
    await this.prisma.groupExpenseCategoryOption.createMany({
      data: this.DEFAULT_EXPENSE_CATEGORIES.map((c, i) => ({ businessId, name: c.name, icon: c.icon, color: c.color, displayOrder: i })),
    });
    return this.prisma.groupExpenseCategoryOption.findMany({ where: { businessId }, orderBy: { displayOrder: 'asc' } });
  }

  async createExpenseCategory(businessId: string, dto: CreateGroupExpenseCategoryDto) {
    const existing = await this.prisma.groupExpenseCategoryOption.findUnique({ where: { businessId_name: { businessId, name: dto.name } } });
    if (existing) {
      throw new ConflictException(`An expense category named "${dto.name}" already exists`);
    }
    const count = await this.prisma.groupExpenseCategoryOption.count({ where: { businessId } });
    return this.prisma.groupExpenseCategoryOption.create({
      data: { businessId, name: dto.name, icon: dto.icon, color: dto.color, displayOrder: count, ...(dto.defaultSplit && { defaultSplit: dto.defaultSplit }) },
    });
  }

  async updateExpenseCategory(businessId: string, id: string, dto: UpdateGroupExpenseCategoryDto) {
    await this.requireExpenseCategory(businessId, id);
    if (dto.name !== undefined) {
      const clash = await this.prisma.groupExpenseCategoryOption.findUnique({ where: { businessId_name: { businessId, name: dto.name } } });
      if (clash && clash.id !== id) {
        throw new ConflictException(`An expense category named "${dto.name}" already exists`);
      }
    }
    return this.prisma.groupExpenseCategoryOption.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.icon !== undefined && { icon: dto.icon }),
        ...(dto.color !== undefined && { color: dto.color }),
        ...(dto.defaultSplit !== undefined && { defaultSplit: dto.defaultSplit }),
      },
    });
  }

  // Existing expenses keep showing this name as plain text -- see
  // GroupExpense.category's own schema comment on why it's decoupled.
  async deleteExpenseCategory(businessId: string, id: string) {
    await this.requireExpenseCategory(businessId, id);
    await this.prisma.groupExpenseCategoryOption.delete({ where: { id } });
    return { id };
  }

  private async requireExpenseCategory(businessId: string, id: string) {
    const category = await this.prisma.groupExpenseCategoryOption.findUnique({ where: { id } });
    if (!category || category.businessId !== businessId) {
      throw new NotFoundException('Expense category not found');
    }
    return category;
  }

  // ---- Expenses ----

  listExpenses(businessId: string, filters: { from?: string; to?: string; category?: string }) {
    const where: Prisma.GroupExpenseWhereInput = { businessId };
    if (filters.category) where.category = filters.category;
    if (filters.from || filters.to) {
      where.date = {
        ...(filters.from && { gte: new Date(filters.from) }),
        ...(filters.to && { lte: new Date(filters.to) }),
      };
    }
    return this.prisma.groupExpense.findMany({
      where,
      include: { paidByMember: true, splits: true },
      // Same tie-break reasoning as listContributions() above.
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async createExpense(businessId: string, dto: CreateGroupExpenseDto) {
    if (dto.paidByMemberId) {
      await this.requireMember(businessId, dto.paidByMemberId);
    }
    const category = dto.category ?? 'Other';
    // Shared the way its category says, unless the expense says otherwise.
    const option = dto.split ? null : await this.prisma.groupExpenseCategoryOption.findUnique({ where: { businessId_name: { businessId, name: category } } });
    const split = dto.split ?? option?.defaultSplit ?? 'EQUAL';
    const paidFrom = dto.paidFrom ?? 'FUND';
    await this.checkExpense(businessId, { amount: dto.amount, paidFrom, paidByMemberId: dto.paidByMemberId ?? null, split, splits: dto.splits ?? [] });
    return this.prisma.groupExpense.create({
      data: {
        businessId,
        amount: dto.amount,
        date: new Date(dto.date),
        category,
        description: dto.description,
        paidByMemberId: dto.paidByMemberId,
        paidFrom,
        split,
        splits: { create: (dto.splits ?? []).map((s) => ({ groupMemberId: s.groupMemberId, units: s.units ?? null, amount: s.amount ?? null })) },
      },
      include: { paidByMember: true, splits: true },
    });
  }

  async updateExpense(businessId: string, id: string, dto: UpdateGroupExpenseDto) {
    const current = await this.prisma.groupExpense.findUnique({ where: { id }, include: { splits: true } });
    if (!current || current.businessId !== businessId) {
      throw new NotFoundException('Expense not found');
    }
    if (dto.paidByMemberId) {
      await this.requireMember(businessId, dto.paidByMemberId);
    }
    // "" clears who paid back to untracked -- see the DTO field's own comment.
    const paidByMemberId = dto.paidByMemberId !== undefined ? dto.paidByMemberId || null : current.paidByMemberId;
    await this.checkExpense(businessId, {
      amount: dto.amount ?? current.amount.toString(),
      paidFrom: dto.paidFrom ?? current.paidFrom,
      paidByMemberId,
      split: dto.split ?? current.split,
      splits: dto.splits ?? current.splits.map((s) => ({ groupMemberId: s.groupMemberId, units: s.units === null ? null : Number(s.units), amount: s.amount?.toString() ?? null })),
    });
    return this.prisma.$transaction(async (tx) => {
      if (dto.splits !== undefined) await tx.groupExpenseSplit.deleteMany({ where: { expenseId: id } });
      return tx.groupExpense.update({
        where: { id },
        data: {
          ...(dto.amount !== undefined && { amount: dto.amount }),
          ...(dto.date !== undefined && { date: new Date(dto.date) }),
          ...(dto.category !== undefined && { category: dto.category }),
          ...(dto.description !== undefined && { description: dto.description }),
          ...(dto.paidByMemberId !== undefined && { paidByMemberId }),
          ...(dto.paidFrom !== undefined && { paidFrom: dto.paidFrom }),
          ...(dto.split !== undefined && { split: dto.split }),
          ...(dto.splits !== undefined && { splits: { create: dto.splits.map((s) => ({ groupMemberId: s.groupMemberId, units: s.units ?? null, amount: s.amount ?? null })) } }),
        },
        include: { paidByMember: true, splits: true },
      });
    });
  }

  // An expense from a pocket names whose; exact amounts add up to it; the
  // members it names are this group's, once each.
  private async checkExpense(businessId: string, expense: { amount: string; paidFrom: string; paidByMemberId: string | null; split: GroupSplit; splits: GroupExpenseSplitDto[] }) {
    if (expense.paidFrom === 'MEMBER' && !expense.paidByMemberId) {
      throw new BadRequestException('Say who paid it from their own pocket');
    }
    const ids = expense.splits.map((s) => s.groupMemberId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('A member is named twice on this expense');
    }
    if (ids.length > 0 && (await this.prisma.groupMember.count({ where: { businessId, id: { in: ids } } })) !== ids.length) {
      throw new NotFoundException('Group member not found');
    }
    if (expense.split === 'EXACT') {
      if (ids.length === 0) throw new BadRequestException('Give each member their exact amount');
      const total = expense.splits.reduce((sum, s) => sum + paisa(s.amount ?? 0), 0);
      if (total !== paisa(expense.amount)) {
        throw new BadRequestException('The exact amounts must add up to the expense');
      }
    }
  }

  async deleteExpense(businessId: string, id: string) {
    await this.requireExpense(businessId, id);
    await this.prisma.groupExpense.delete({ where: { id } });
    return { success: true };
  }

  // ---- Month budgets ----
  // Manually entered (Month + Year + amount, typed in via the "Add Month"
  // form) -- see GroupMonthlyBudget's schema comment for why this is a
  // plain standalone record, not computed from real expense/contribution
  // data the way an earlier version of this tab was.

  listMonthBudgets(businessId: string) {
    return this.prisma.groupMonthlyBudget.findMany({
      where: { businessId },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
  }

  async createMonthBudget(businessId: string, dto: CreateGroupMonthBudgetDto) {
    const existing = await this.prisma.groupMonthlyBudget.findUnique({
      where: { businessId_month_year: { businessId, month: dto.month, year: dto.year } },
    });
    if (existing) {
      throw new ConflictException(`A budget for ${dto.month}/${dto.year} already exists`);
    }
    return this.prisma.groupMonthlyBudget.create({
      data: { businessId, month: dto.month, year: dto.year, budgetAmount: dto.budgetAmount },
    });
  }

  async updateMonthBudget(businessId: string, id: string, dto: UpdateGroupMonthBudgetDto) {
    const budget = await this.requireMonthBudget(businessId, id);
    if (dto.month !== undefined || dto.year !== undefined) {
      const month = dto.month ?? budget.month;
      const year = dto.year ?? budget.year;
      const clash = await this.prisma.groupMonthlyBudget.findUnique({ where: { businessId_month_year: { businessId, month, year } } });
      if (clash && clash.id !== id) {
        throw new ConflictException(`A budget for ${month}/${year} already exists`);
      }
    }
    return this.prisma.groupMonthlyBudget.update({
      where: { id },
      data: {
        ...(dto.month !== undefined && { month: dto.month }),
        ...(dto.year !== undefined && { year: dto.year }),
        ...(dto.budgetAmount !== undefined && { budgetAmount: dto.budgetAmount }),
      },
    });
  }

  async deleteMonthBudget(businessId: string, id: string) {
    await this.requireMonthBudget(businessId, id);
    await this.prisma.groupMonthlyBudget.delete({ where: { id } });
    return { id };
  }

  private async requireMonthBudget(businessId: string, id: string) {
    const budget = await this.prisma.groupMonthlyBudget.findUnique({ where: { id } });
    if (!budget || budget.businessId !== businessId) {
      throw new NotFoundException('Month budget not found');
    }
    return budget;
  }

  // ---- Settings ----

  async getSettings(businessId: string) {
    const settings = await this.prisma.groupSettings.findUnique({ where: { businessId } });
    return settings ?? { businessId, ...DEFAULT_SETTINGS };
  }

  async updateSettings(businessId: string, dto: UpdateGroupSettingsDto) {
    if (dto.cashHolderMemberId) {
      await this.requireMember(businessId, dto.cashHolderMemberId);
    }
    const data = {
      ...(dto.kind !== undefined && { kind: dto.kind }),
      ...(dto.monthStartDay !== undefined && { monthStartDay: dto.monthStartDay }),
      ...(dto.cashHolderMemberId !== undefined && { cashHolderMemberId: dto.cashHolderMemberId }),
      ...(dto.mealsOn !== undefined && { mealsOn: dto.mealsOn }),
      ...(dto.breakfastUnits !== undefined && { breakfastUnits: dto.breakfastUnits }),
      ...(dto.lunchUnits !== undefined && { lunchUnits: dto.lunchUnits }),
      ...(dto.dinnerUnits !== undefined && { dinnerUnits: dto.dinnerUnits }),
    };
    return this.prisma.groupSettings.upsert({ where: { businessId }, update: data, create: { businessId, ...data } });
  }

  // ---- Meals ----

  listMeals(businessId: string, filters: { from?: string; to?: string }) {
    return this.prisma.groupMeal.findMany({
      where: { businessId, ...((filters.from || filters.to) && { date: { ...(filters.from && { gte: new Date(filters.from) }), ...(filters.to && { lte: new Date(filters.to) }) } }) },
      orderBy: [{ date: 'asc' }],
    });
  }

  // A day's meals: each entry replaces that member's day, and one with no
  // meals at all clears it.
  async setMeals(businessId: string, dto: SetGroupMealsDto) {
    const ids = dto.entries.map((e) => e.groupMemberId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('A member is listed twice for this day');
    }
    if (ids.length > 0 && (await this.prisma.groupMember.count({ where: { businessId, id: { in: ids } } })) !== ids.length) {
      throw new NotFoundException('Group member not found');
    }
    const date = new Date(dto.date);
    await this.prisma.$transaction(async (tx) => {
      for (const entry of dto.entries) {
        const meals = { breakfast: entry.breakfast, lunch: entry.lunch, dinner: entry.dinner, guests: entry.guests };
        if (!entry.breakfast && !entry.lunch && !entry.dinner && !entry.guests) {
          await tx.groupMeal.deleteMany({ where: { groupMemberId: entry.groupMemberId, date } });
        } else {
          await tx.groupMeal.upsert({ where: { groupMemberId_date: { groupMemberId: entry.groupMemberId, date } }, update: meals, create: { businessId, groupMemberId: entry.groupMemberId, date, ...meals } });
        }
      }
    });
    return this.listMeals(businessId, { from: dto.date, to: dto.date });
  }

  // ---- Settlement ----

  async getSettlement(businessId: string, from?: string, to?: string): Promise<SettlementResult> {
    const { periodStart, periodEnd } = await this.resolvePeriod(businessId, from, to);
    return this.computeSettlement(businessId, periodStart, periodEnd);
  }

  listSettlementHistory(businessId: string) {
    return this.prisma.groupSettlement.findMany({
      where: { businessId },
      include: { members: { include: { groupMember: true } } },
      orderBy: { periodStart: 'desc' },
    });
  }

  // A period can be closed once: closing it again (a double click, a second
  // tab, or a range overlapping one already closed) would split or count the
  // same expenses twice in the history. Runs under a per-group lock so two
  // closes can't both pass the overlap check.
  async closeSettlement(businessId: string, dto: CloseSettlementDto, userId: string) {
    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);
    if (periodEnd.getTime() < periodStart.getTime()) {
      throw new BadRequestException('The period ends before it starts');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`group-settlement:${businessId}`}))`;

      const overlapping = await tx.groupSettlement.findFirst({
        where: { businessId, periodStart: { lte: periodEnd }, periodEnd: { gte: periodStart } },
        orderBy: { periodStart: 'asc' },
      });
      if (overlapping) {
        const day = (d: Date) => d.toISOString().slice(0, 10);
        throw new ConflictException(
          `A settlement for ${day(overlapping.periodStart)} to ${day(overlapping.periodEnd)} is already closed and overlaps this period`,
        );
      }

      const result = await this.computeSettlement(businessId, periodStart, periodEnd, tx);
      if (result.memberCount === 0) {
        throw new BadRequestException('Add at least one active member before closing a settlement');
      }

      // Carried forward: each balance opens the next month as a CARRY
      // contribution, so a member owed money starts it in credit.
      if (dto.carryForward) {
        const next = new Date(periodEnd.getTime() + DAY_MS);
        const label = `Carried from ${dayKey(periodStart)} to ${dayKey(periodEnd)}`;
        const carried = result.members.filter((m) => Number(m.balance) !== 0);
        if (carried.length > 0) {
          await tx.groupContribution.createMany({ data: carried.map((m) => ({ businessId, groupMemberId: m.groupMemberId, amount: m.balance, kind: 'CARRY' as const, date: next, note: label })) });
        }
      }

      return tx.groupSettlement.create({
        data: {
          businessId,
          periodStart,
          periodEnd,
          totalExpense: result.totalExpense,
          memberCount: result.memberCount,
          perMemberShare: result.perMemberShare,
          mealExpense: result.mealExpense,
          mealUnits: result.mealUnits,
          mealRate: result.mealRate,
          cashInHand: result.cashInHand,
          carriedForward: !!dto.carryForward,
          closedBy: userId,
          members: {
            create: result.members.map((m) => ({
              groupMemberId: m.groupMemberId,
              contributed: m.contributed,
              pocketPaid: m.pocketPaid,
              mealUnits: m.mealUnits,
              mealCost: m.mealCost,
              share: m.share,
              balance: m.balance,
            })),
          },
        },
        include: { members: { include: { groupMember: true } } },
      });
    });
  }

  // Shared by getSettlement() (live, uncommitted numbers for the current or
  // any requested period) and closeSettlement() (same computation, then
  // persisted as a locked snapshot) -- one source of truth for the math
  // (settleGroup()) so the two never drift apart.
  private async computeSettlement(
    businessId: string,
    periodStart: Date,
    periodEnd: Date,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<SettlementResult> {
    const inPeriod = { gte: periodStart, lte: periodEnd };
    const [members, contributions, expenses, meals, settings] = await Promise.all([
      client.groupMember.findMany({ where: { businessId }, orderBy: { createdAt: 'asc' } }),
      client.groupContribution.findMany({ where: { businessId, date: inPeriod }, select: { groupMemberId: true, amount: true } }),
      client.groupExpense.findMany({ where: { businessId, date: inPeriod }, include: { splits: true } }),
      client.groupMeal.findMany({ where: { businessId, date: inPeriod } }),
      client.groupSettings.findUnique({ where: { businessId } }),
    ]);
    const units = {
      breakfast: Number(settings?.breakfastUnits ?? DEFAULT_SETTINGS.breakfastUnits),
      lunch: Number(settings?.lunchUnits ?? DEFAULT_SETTINGS.lunchUnits),
      dinner: Number(settings?.dinnerUnits ?? DEFAULT_SETTINGS.dinnerUnits),
    };
    const result = settleGroup({
      start: dayKey(periodStart),
      end: dayKey(periodEnd),
      members: members.map((m) => ({ id: m.id, name: m.name, active: m.status === 'ACTIVE', joinedOn: m.joinedOn ? dayKey(m.joinedOn) : null, leftOn: m.leftOn ? dayKey(m.leftOn) : null, shareUnits: Number(m.shareUnits) })),
      contributions: contributions.map((c) => ({ memberId: c.groupMemberId, amount: Number(c.amount) })),
      expenses: expenses.map((e) => ({
        amount: Number(e.amount),
        date: dayKey(e.date),
        paidFromPocket: e.paidFrom === 'MEMBER',
        paidByMemberId: e.paidByMemberId,
        split: e.split,
        splits: e.splits.map((sp) => ({ memberId: sp.groupMemberId, units: sp.units === null ? null : Number(sp.units), amount: sp.amount === null ? null : Number(sp.amount) })),
      })),
      meals: meals.map((m) => ({ memberId: m.groupMemberId, units: m.breakfast * units.breakfast + m.lunch * units.lunch + m.dinner * units.dinner + Number(m.guests) })),
      mealsOn: settings?.mealsOn ?? false,
    });
    const money = (value: number) => value.toFixed(2);
    return {
      periodStart,
      periodEnd,
      totalExpense: money(result.totalExpense),
      memberCount: result.memberCount,
      perMemberShare: money(result.perMemberShare),
      mealExpense: money(result.mealExpense),
      mealUnits: money(result.mealUnits),
      mealRate: result.mealRate.toFixed(4),
      cashInHand: money(result.cashInHand),
      members: result.rows.map((row) => ({
        groupMemberId: row.memberId,
        name: row.name,
        sharing: row.sharing,
        grossDeposited: money(row.grossDeposited),
        returned: money(row.returned),
        contributed: money(row.contributed),
        pocketPaid: money(row.pocketPaid),
        mealUnits: money(row.mealUnits),
        mealCost: money(row.mealCost),
        otherShare: money(row.otherShare),
        share: money(row.share),
        balance: money(row.balance),
      })),
    };
  }

  // No from/to given -- this group month: from its start day (the 1st
  // unless the settings say otherwise) in the current Dhaka calendar, to the
  // day before the next one. Date-only values, like the stored dates.
  private async resolvePeriod(businessId: string, from?: string, to?: string): Promise<{ periodStart: Date; periodEnd: Date }> {
    if (from && to) {
      return { periodStart: new Date(from), periodEnd: new Date(to) };
    }
    const settings = await this.prisma.groupSettings.findUnique({ where: { businessId }, select: { monthStartDay: true } });
    const startDay = settings?.monthStartDay ?? 1;
    const today = dhakaToday();
    const month = today.day >= startDay ? today.month - 1 : today.month - 2;
    const periodStart = new Date(Date.UTC(today.year, month, startDay));
    const periodEnd = new Date(Date.UTC(today.year, month + 1, startDay) - DAY_MS);
    return { periodStart, periodEnd };
  }

  private async requireMember(businessId: string, id: string) {
    const member = await this.prisma.groupMember.findUnique({ where: { id } });
    if (!member || member.businessId !== businessId) {
      throw new NotFoundException('Group member not found');
    }
    return member;
  }

  private async requireContribution(businessId: string, id: string) {
    const contribution = await this.prisma.groupContribution.findUnique({ where: { id } });
    if (!contribution || contribution.businessId !== businessId) {
      throw new NotFoundException('Contribution not found');
    }
    return contribution;
  }

  private async requireExpense(businessId: string, id: string) {
    const expense = await this.prisma.groupExpense.findUnique({ where: { id } });
    if (!expense || expense.businessId !== businessId) {
      throw new NotFoundException('Expense not found');
    }
    return expense;
  }
}
