import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { GroupMemberStatus, Prisma } from '@prisma/client';
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
  share: string;
  balance: string;
}

export interface SettlementResult {
  periodStart: Date;
  periodEnd: Date;
  totalExpense: string;
  memberCount: number;
  perMemberShare: string;
  members: SettlementMemberRow[];
}

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
      data: { businessId, name: dto.name, phone: dto.phone, photoUrl: dto.photoUrl },
    });
  }

  async updateMember(businessId: string, id: string, dto: UpdateGroupMemberDto) {
    await this.requireMember(businessId, id);
    return this.prisma.groupMember.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.photoUrl !== undefined && { photoUrl: dto.photoUrl }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    });
  }

  // Same delete-or-archive shape as ContactsService.delete(): hard-delete
  // only if this member was never actually used anywhere; otherwise archive
  // so historical settlement rows keep pointing at a real member.
  async deleteMember(businessId: string, id: string): Promise<{ id: string; action: 'deleted' | 'archived' }> {
    await this.requireMember(businessId, id);

    const [contributionCount, expenseCount, settlementCount] = await Promise.all([
      this.prisma.groupContribution.count({ where: { groupMemberId: id } }),
      this.prisma.groupExpense.count({ where: { paidByMemberId: id } }),
      this.prisma.groupSettlementMember.count({ where: { groupMemberId: id } }),
    ]);

    if (contributionCount === 0 && expenseCount === 0 && settlementCount === 0) {
      await this.prisma.groupMember.delete({ where: { id } });
      return { id, action: 'deleted' };
    }

    await this.prisma.groupMember.update({ where: { id }, data: { status: 'ARCHIVED' } });
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
        date: new Date(dto.date),
        note: dto.note,
      },
    });
  }

  async updateContribution(businessId: string, id: string, dto: UpdateGroupContributionDto) {
    await this.requireContribution(businessId, id);
    if (dto.groupMemberId) {
      await this.requireMember(businessId, dto.groupMemberId);
    }
    return this.prisma.groupContribution.update({
      where: { id },
      data: {
        ...(dto.groupMemberId !== undefined && { groupMemberId: dto.groupMemberId }),
        ...(dto.amount !== undefined && { amount: dto.amount }),
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
      data: { businessId, name: dto.name, icon: dto.icon, color: dto.color, displayOrder: count },
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
      include: { paidByMember: true },
      // Same tie-break reasoning as listContributions() above.
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async createExpense(businessId: string, dto: CreateGroupExpenseDto) {
    if (dto.paidByMemberId) {
      await this.requireMember(businessId, dto.paidByMemberId);
    }
    return this.prisma.groupExpense.create({
      data: {
        businessId,
        amount: dto.amount,
        date: new Date(dto.date),
        category: dto.category ?? 'Other',
        description: dto.description,
        paidByMemberId: dto.paidByMemberId,
      },
    });
  }

  async updateExpense(businessId: string, id: string, dto: UpdateGroupExpenseDto) {
    await this.requireExpense(businessId, id);
    if (dto.paidByMemberId) {
      await this.requireMember(businessId, dto.paidByMemberId);
    }
    return this.prisma.groupExpense.update({
      where: { id },
      data: {
        ...(dto.amount !== undefined && { amount: dto.amount }),
        ...(dto.date !== undefined && { date: new Date(dto.date) }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.description !== undefined && { description: dto.description }),
        // "" clears it back to untracked -- see the DTO field's own comment.
        ...(dto.paidByMemberId !== undefined && { paidByMemberId: dto.paidByMemberId || null }),
      },
      include: { paidByMember: true },
    });
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

  // ---- Settlement ----

  async getSettlement(businessId: string, from?: string, to?: string): Promise<SettlementResult> {
    const { periodStart, periodEnd } = this.resolvePeriod(from, to);
    return this.computeSettlement(businessId, periodStart, periodEnd);
  }

  listSettlementHistory(businessId: string) {
    return this.prisma.groupSettlement.findMany({
      where: { businessId },
      include: { members: { include: { groupMember: true } } },
      orderBy: { periodStart: 'desc' },
    });
  }

  async closeSettlement(businessId: string, dto: CloseSettlementDto, userId: string) {
    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);
    const result = await this.computeSettlement(businessId, periodStart, periodEnd);

    if (result.memberCount === 0) {
      throw new BadRequestException('Add at least one active member before closing a settlement');
    }

    return this.prisma.groupSettlement.create({
      data: {
        businessId,
        periodStart,
        periodEnd,
        totalExpense: result.totalExpense,
        memberCount: result.memberCount,
        perMemberShare: result.perMemberShare,
        closedBy: userId,
        members: {
          create: result.members.map((m) => ({
            groupMemberId: m.groupMemberId,
            contributed: m.contributed,
            share: m.share,
            balance: m.balance,
          })),
        },
      },
      include: { members: { include: { groupMember: true } } },
    });
  }

  // Shared by getSettlement() (live, uncommitted numbers for the current or
  // any requested period) and closeSettlement() (same computation, then
  // persisted as a locked snapshot) -- one source of truth for the split
  // math so the two never drift apart.
  private async computeSettlement(businessId: string, periodStart: Date, periodEnd: Date): Promise<SettlementResult> {
    const [members, expenseAgg, contributions] = await Promise.all([
      this.prisma.groupMember.findMany({ where: { businessId, status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } }),
      this.prisma.groupExpense.aggregate({
        where: { businessId, date: { gte: periodStart, lte: periodEnd } },
        _sum: { amount: true },
      }),
      // Individual rows, not groupBy's _sum -- a plain sum would net
      // deposits and returns (negative amounts, see AddContributionModal's
      // Deposit/Return toggle) into one figure, losing the gross/returned
      // breakdown the settlement view shows separately.
      this.prisma.groupContribution.findMany({
        where: { businessId, date: { gte: periodStart, lte: periodEnd } },
        select: { groupMemberId: true, amount: true },
      }),
    ]);

    const totalsByMember = new Map<string, { deposited: Prisma.Decimal; returned: Prisma.Decimal }>();
    for (const c of contributions) {
      const amount = new Prisma.Decimal(c.amount);
      const totals = totalsByMember.get(c.groupMemberId) ?? { deposited: new Prisma.Decimal(0), returned: new Prisma.Decimal(0) };
      if (amount.isNegative()) {
        totals.returned = totals.returned.plus(amount.abs());
      } else {
        totals.deposited = totals.deposited.plus(amount);
      }
      totalsByMember.set(c.groupMemberId, totals);
    }
    const totalExpense = new Prisma.Decimal(expenseAgg._sum.amount ?? 0);
    const memberCount = members.length;

    if (memberCount === 0) {
      return { periodStart, periodEnd, totalExpense: totalExpense.toFixed(2), memberCount: 0, perMemberShare: '0.00', members: [] };
    }

    // Equal split, floored to whole paisa per member -- the last member (by
    // join order) absorbs whatever paisa remainder is left over, so shares
    // always sum EXACTLY to totalExpense (see the GroupSettlement.
    // perMemberShare schema comment).
    const totalCents = totalExpense.times(100);
    const baseCents = totalCents.dividedBy(memberCount).floor();
    const remainderCents = totalCents.minus(baseCents.times(memberCount));
    const baseShare = baseCents.dividedBy(100);
    const lastShare = baseCents.plus(remainderCents).dividedBy(100);

    const rows: SettlementMemberRow[] = members.map((member, index) => {
      const totals = totalsByMember.get(member.id) ?? { deposited: new Prisma.Decimal(0), returned: new Prisma.Decimal(0) };
      const contributed = totals.deposited.minus(totals.returned);
      const share = index === memberCount - 1 ? lastShare : baseShare;
      const balance = contributed.minus(share);
      return {
        groupMemberId: member.id,
        name: member.name,
        grossDeposited: totals.deposited.toFixed(2),
        returned: totals.returned.toFixed(2),
        contributed: contributed.toFixed(2),
        share: share.toFixed(2),
        balance: balance.toFixed(2),
      };
    });

    return {
      periodStart,
      periodEnd,
      totalExpense: totalExpense.toFixed(2),
      memberCount,
      perMemberShare: baseShare.toFixed(2),
      members: rows,
    };
  }

  // No from/to given -- defaults to the current calendar month (UTC), same
  // "whole month" framing as the rest of the app's reports.
  private resolvePeriod(from?: string, to?: string): { periodStart: Date; periodEnd: Date } {
    if (from && to) {
      return { periodStart: new Date(from), periodEnd: new Date(to) };
    }
    const now = new Date();
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
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
