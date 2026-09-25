import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { GroupExpenseCategory, GroupMemberStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CloseSettlementDto } from './dto/close-settlement.dto.js';
import { CreateGroupContributionDto } from './dto/create-group-contribution.dto.js';
import { CreateGroupExpenseDto } from './dto/create-group-expense.dto.js';
import { CreateGroupMemberDto } from './dto/create-group-member.dto.js';
import { UpdateGroupMemberDto } from './dto/update-group-member.dto.js';

export interface SettlementMemberRow {
  groupMemberId: string;
  name: string;
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
      data: { businessId, name: dto.name, phone: dto.phone },
    });
  }

  async updateMember(businessId: string, id: string, dto: UpdateGroupMemberDto) {
    await this.requireMember(businessId, id);
    return this.prisma.groupMember.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
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
      orderBy: { date: 'desc' },
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

  async deleteContribution(businessId: string, id: string) {
    await this.requireContribution(businessId, id);
    await this.prisma.groupContribution.delete({ where: { id } });
    return { success: true };
  }

  // ---- Expenses ----

  listExpenses(businessId: string, filters: { from?: string; to?: string; category?: GroupExpenseCategory }) {
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
      orderBy: { date: 'desc' },
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
        category: dto.category ?? 'OTHER',
        description: dto.description,
        paidByMemberId: dto.paidByMemberId,
      },
    });
  }

  async deleteExpense(businessId: string, id: string) {
    await this.requireExpense(businessId, id);
    await this.prisma.groupExpense.delete({ where: { id } });
    return { success: true };
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
      this.prisma.groupContribution.groupBy({
        by: ['groupMemberId'],
        where: { businessId, date: { gte: periodStart, lte: periodEnd } },
        _sum: { amount: true },
      }),
    ]);

    const contributedByMember = new Map(contributions.map((c) => [c.groupMemberId, new Prisma.Decimal(c._sum.amount ?? 0)]));
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
      const contributed = contributedByMember.get(member.id) ?? new Prisma.Decimal(0);
      const share = index === memberCount - 1 ? lastShare : baseShare;
      const balance = contributed.minus(share);
      return {
        groupMemberId: member.id,
        name: member.name,
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
