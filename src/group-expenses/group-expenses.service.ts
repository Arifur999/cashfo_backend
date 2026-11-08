import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { GroupActivityAction, GroupContributionKind, GroupMemberRole, GroupMemberStatus, GroupSplit, Prisma } from '@prisma/client';
import { dhakaDateOnly, dhakaToday } from '../common/dhaka.js';
import { GroupAccessService, type MemberAccess } from '../group-access/group-access.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CloseSettlementDto } from './dto/close-settlement.dto.js';
import { CreateGroupContributionDto } from './dto/create-group-contribution.dto.js';
import { CreateGroupCashHandoverDto, UpdateGroupCashHandoverDto } from './dto/group-cash-handover.dto.js';
import { CreateGroupExpenseCategoryDto } from './dto/create-group-expense-category.dto.js';
import { CreateGroupExpenseDto } from './dto/create-group-expense.dto.js';
import { CreateGroupMemberDto } from './dto/create-group-member.dto.js';
import { CreateGroupMonthBudgetDto } from './dto/create-group-month-budget.dto.js';
import { GroupCategorySetupDto } from './dto/group-category-setup.dto.js';
import { GroupCostSplitDto } from './dto/group-cost-split.dto.js';
import { UpdateGroupContributionDto } from './dto/update-group-contribution.dto.js';
import { UpdateGroupExpenseCategoryDto } from './dto/update-group-expense-category.dto.js';
import { UpdateGroupExpenseDto } from './dto/update-group-expense.dto.js';
import { UpdateGroupMemberDto } from './dto/update-group-member.dto.js';
import { UpdateGroupMonthBudgetDto } from './dto/update-group-month-budget.dto.js';
import { GroupExpenseSplitDto } from './dto/group-expense-split.dto.js';
import { SetGroupMealsDto } from './dto/group-meal.dto.js';
import { UpdateGroupSettingsDto } from './dto/group-settings.dto.js';
import { SettleUpDto } from './dto/settle-up.dto.js';
import { cashbook, cashByAccountant, cashMovements } from './group-cash.js';
import { initialsOf } from './group-names.js';
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
  // Each accountant's cash at the period's end (the Cash book's figure).
  accountantCash: { groupMemberId: string; name: string; cash: string }[];
  members: SettlementMemberRow[];
}

// A group's settings before any are saved.
const DEFAULT_SETTINGS = {
  kind: 'FAMILY' as const,
  monthStartDay: 1,
  cashHolderMemberId: null,
  mealsOn: false,
  breakfastUnits: '0.50',
  lunchUnits: '1.00',
  dinnerUnits: '1.00',
  costSplit: 'EQUAL' as const,
  budgetWarnPercent: 90,
  pausedAt: null,
};

// The categories a group starts with when New group didn't choose its own.
const DEFAULT_EXPENSE_CATEGORIES: { name: string; icon: string; color: string; defaultSplit?: GroupSplit }[] = [
  { name: 'Bazar & grocery', icon: 'shopping-cart', color: 'teal', defaultSplit: 'SHARES' },
  { name: 'Rent', icon: 'house', color: 'blue' },
  { name: 'Utility', icon: 'zap', color: 'orange' },
  { name: 'Medicine', icon: 'pill', color: 'pink' },
  { name: 'Maid', icon: 'sparkles', color: 'violet' },
  { name: 'Internet', icon: 'wifi', color: 'blue' },
  { name: 'Education', icon: 'book-open', color: 'amber' },
  { name: 'Transport', icon: 'car', color: 'teal' },
  { name: 'Other', icon: 'package', color: 'gray' },
];

// At most this many accountants keep a group's cash at once.
const MAX_ACCOUNTANTS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;
const dayKey = (date: Date) => date.toISOString().slice(0, 10);
// undefined leaves a date as it is; null clears it.
const dateOrNull = (value: string | null | undefined) => (value === undefined ? undefined : value === null ? null : new Date(value));
const paisa = (value: string | number | Prisma.Decimal) => Math.round(Number(value) * 100);
const money = (value: number | string | Prisma.Decimal) => Number(value).toFixed(2);

type Activity = {
  action: GroupActivityAction;
  entity: string;
  entityId?: string | null;
  summary: Record<string, unknown>;
  change?: { field: string; from: unknown; to: unknown }[];
};

// What changed between two snapshots of a record, field by field.
function changesOf(before: Record<string, unknown>, after: Record<string, unknown>): { field: string; from: unknown; to: unknown }[] {
  return Object.keys(after)
    .filter((field) => after[field] !== undefined && String(before[field] ?? '') !== String(after[field] ?? ''))
    .map((field) => ({ field, from: before[field] ?? null, to: after[field] ?? null }));
}

@Injectable()
export class GroupExpensesService {
  private readonly logger = new Logger(GroupExpensesService.name);

  constructor(
    private readonly prisma: PrismaService,
    // Keeps a member's login in step with their role (Members & access).
    private readonly access: GroupAccessService,
  ) {}

  // ---- Activity log ----

  // Every change is written here; a failed write never fails the change.
  private async record(businessId: string, actorUserId: string | null, activity: Activity) {
    try {
      await this.prisma.groupActivity.create({
        data: {
          businessId,
          actorUserId,
          action: activity.action,
          entity: activity.entity,
          entityId: activity.entityId ?? null,
          summary: activity.summary as Prisma.InputJsonObject,
          ...(activity.change && activity.change.length > 0 && { change: activity.change as unknown as Prisma.InputJsonArray }),
        },
      });
    } catch (error) {
      this.logger.warn(`Could not log a group change for ${businessId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // viewerUserId: who is reading. Each line names the person who made the
  // change; someone who turned off "Show my name in groups" (Settings ›
  // Data & privacy) reads as their initials to everyone but themselves.
  async listActivity(businessId: string, filters: { action?: GroupActivityAction; page?: number; limit?: number }, viewerUserId: string | null = null) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 50;
    const where: Prisma.GroupActivityWhereInput = { businessId, ...(filters.action && { action: filters.action }) };
    const [data, total, actors] = await Promise.all([
      this.prisma.groupActivity.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.groupActivity.count({ where }),
      this.prisma.groupMember.findMany({ where: { businessId, isOwner: true }, select: { name: true } }),
    ]);
    // A line from before actors were known stands for the owner.
    const owner = actors[0]?.name ?? null;
    const actorIds = [...new Set(data.map((row) => row.actorUserId).filter((id): id is string => !!id))];
    const users = actorIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, showNameInGroups: true } })
      : [];
    const nameOf = new Map(users.map((user) => [user.id, user.id === viewerUserId || user.showNameInGroups ? user.name : initialsOf(user.name)]));
    return {
      data: data.map((row) => ({ ...row, actorName: (row.actorUserId && nameOf.get(row.actorUserId)) || owner })),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  // ---- Members ----

  // withAccess (the owner asking): each member's login and waiting access
  // link, for Members & access. Others get access: null -- usernames and
  // last logins are the owner's to see.
  async listMembers(businessId: string, status?: GroupMemberStatus, withAccess = false) {
    const [members, access] = await Promise.all([
      this.prisma.groupMember.findMany({
        where: { businessId, ...(status && { status }) },
        orderBy: [{ isOwner: 'desc' }, { createdAt: 'asc' }],
      }),
      withAccess ? this.access.accessOf(businessId) : null,
    ]);
    const none: MemberAccess = { login: null, link: null };
    return members.map((member) => ({ ...member, access: access ? (access.get(member.id) ?? none) : null }));
  }

  // A third active accountant is refused.
  private async checkAccountants(businessId: string, exceptId?: string) {
    const count = await this.prisma.groupMember.count({
      where: { businessId, role: 'ACCOUNTANT', status: 'ACTIVE', ...(exceptId && { id: { not: exceptId } }) },
    });
    if (count >= MAX_ACCOUNTANTS) {
      throw new BadRequestException('A family can have up to 2 accountants.');
    }
  }

  // The cash holder is always an active accountant when there is one: the
  // first accountant takes over when the holder stops being one.
  private async keepCashHolder(businessId: string) {
    const settings = await this.prisma.groupSettings.findUnique({ where: { businessId }, select: { cashHolderMemberId: true } });
    const accountants = await this.prisma.groupMember.findMany({
      where: { businessId, role: 'ACCOUNTANT', status: 'ACTIVE' },
      orderBy: [{ isOwner: 'desc' }, { createdAt: 'asc' }],
      select: { id: true },
    });
    const holder = settings?.cashHolderMemberId ?? null;
    if (holder && accountants.some((member) => member.id === holder)) return;
    const next = accountants[0]?.id ?? null;
    if (next === holder) return;
    await this.prisma.groupSettings.upsert({ where: { businessId }, update: { cashHolderMemberId: next }, create: { businessId, cashHolderMemberId: next } });
  }

  async createMember(businessId: string, dto: CreateGroupMemberDto, actorUserId: string | null = null) {
    if (dto.role === 'ACCOUNTANT') await this.checkAccountants(businessId);
    if (dto.isOwner && (await this.prisma.groupMember.count({ where: { businessId, isOwner: true } })) > 0) {
      throw new BadRequestException('This group already has its owner');
    }
    const member = await this.prisma.groupMember.create({
      data: {
        businessId,
        name: dto.name,
        phone: dto.phone,
        photoUrl: dto.photoUrl,
        shareUnits: dto.shareUnits,
        joinedOn: dateOrNull(dto.joinedOn),
        ...(dto.role && { role: dto.role }),
        ...(dto.isOwner && { isOwner: true }),
        ...(dto.household !== undefined && { household: dto.household }),
      },
    });
    if (member.role === 'ACCOUNTANT') await this.keepCashHolder(businessId);
    await this.record(businessId, actorUserId, { action: 'ADDED', entity: 'MEMBER', entityId: member.id, summary: { member: member.name, role: member.role } });
    return member;
  }

  // Archiving someone records today as the day they left (unless the edit
  // says), so they still share this month's costs up to it; bringing them
  // back clears it. The owner stays in.
  async updateMember(businessId: string, id: string, dto: UpdateGroupMemberDto, actorUserId: string | null = null) {
    const current = await this.requireMember(businessId, id);
    if (current.isOwner && dto.status === 'ARCHIVED') {
      throw new BadRequestException("The group's owner can't be made inactive");
    }
    const becomesAccountant = dto.role === 'ACCOUNTANT' && current.role !== 'ACCOUNTANT';
    const comesBackAsAccountant = dto.status === 'ACTIVE' && current.status !== 'ACTIVE' && (dto.role ?? current.role) === 'ACCOUNTANT';
    if (becomesAccountant || comesBackAsAccountant) await this.checkAccountants(businessId, id);
    const archiving = dto.status === 'ARCHIVED' && current.status === 'ACTIVE';
    const leftOn =
      dto.leftOn !== undefined ? dateOrNull(dto.leftOn) : archiving && !current.leftOn ? dhakaDateOnly(new Date()) : dto.status === 'ACTIVE' ? null : undefined;
    const joinedOn = dateOrNull(dto.joinedOn);
    const joined = joinedOn !== undefined ? joinedOn : current.joinedOn;
    const left = leftOn !== undefined ? leftOn : current.leftOn;
    if (joined && left && left < joined) {
      throw new BadRequestException("Someone can't leave before they joined");
    }
    const updated = await this.prisma.groupMember.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.photoUrl !== undefined && { photoUrl: dto.photoUrl }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.shareUnits !== undefined && { shareUnits: dto.shareUnits }),
        ...(dto.role !== undefined && { role: dto.role }),
        ...(dto.household !== undefined && { household: dto.household }),
        ...(joinedOn !== undefined && { joinedOn }),
        ...(leftOn !== undefined && { leftOn }),
      },
    });
    if (dto.role !== undefined || dto.status !== undefined) {
      await this.keepCashHolder(businessId);
      // A role without access, or an inactive member, can't log in any more.
      await this.access.sync(this.prisma, updated);
    }
    const change = changesOf(
      {
        name: current.name,
        phone: current.phone,
        role: current.role,
        status: current.status,
        household: current.household,
        joinedOn: current.joinedOn && dayKey(current.joinedOn),
      },
      { name: dto.name, phone: dto.phone, role: dto.role, status: dto.status, household: dto.household, joinedOn: dto.joinedOn },
    );
    if (change.length > 0)
      await this.record(businessId, actorUserId, { action: 'EDITED', entity: 'MEMBER', entityId: id, summary: { member: updated.name }, change });
    return updated;
  }

  // Same delete-or-archive shape as ContactsService.delete(): hard-delete
  // only if this member was never actually used anywhere; otherwise archive
  // so historical settlement rows keep pointing at a real member. The owner
  // can't be removed.
  async deleteMember(businessId: string, id: string, actorUserId: string | null = null): Promise<{ id: string; action: 'deleted' | 'archived' }> {
    const member = await this.requireMember(businessId, id);
    if (member.isOwner) {
      throw new BadRequestException("The group's owner can't be removed");
    }
    // Removed or archived, they can't log in to the group any more.
    await this.access.sync(this.prisma, { ...member, status: 'ARCHIVED' });

    const [contributionCount, receivedCount, expenseCount, settlementCount, splitCount, mealCount, handoverCount] = await Promise.all([
      this.prisma.groupContribution.count({ where: { groupMemberId: id } }),
      this.prisma.groupContribution.count({ where: { receivedByMemberId: id } }),
      this.prisma.groupExpense.count({ where: { paidByMemberId: id } }),
      this.prisma.groupSettlementMember.count({ where: { groupMemberId: id } }),
      this.prisma.groupExpenseSplit.count({ where: { groupMemberId: id } }),
      this.prisma.groupMeal.count({ where: { groupMemberId: id } }),
      this.prisma.groupCashHandover.count({ where: { OR: [{ fromMemberId: id }, { toMemberId: id }] } }),
    ]);

    if (
      contributionCount === 0 &&
      receivedCount === 0 &&
      expenseCount === 0 &&
      settlementCount === 0 &&
      splitCount === 0 &&
      mealCount === 0 &&
      handoverCount === 0
    ) {
      await this.prisma.groupMember.delete({ where: { id } });
      await this.keepCashHolder(businessId);
      await this.record(businessId, actorUserId, { action: 'DELETED', entity: 'MEMBER', entityId: id, summary: { member: member.name } });
      return { id, action: 'deleted' };
    }

    await this.prisma.groupMember.update({ where: { id }, data: { status: 'ARCHIVED', ...(!member.leftOn && { leftOn: dhakaDateOnly(new Date()) }) } });
    await this.keepCashHolder(businessId);
    await this.record(businessId, actorUserId, {
      action: 'EDITED',
      entity: 'MEMBER',
      entityId: id,
      summary: { member: member.name },
      change: [{ field: 'status', from: 'ACTIVE', to: 'ARCHIVED' }],
    });
    return { id, action: 'archived' };
  }

  // Members > Cost split: everyone the same, or a percent for each active
  // member adding up to 100. Closed months keep the split they were closed
  // with (their record is locked); open ones follow the new one.
  async setCostSplit(businessId: string, dto: GroupCostSplitDto, actorUserId: string | null = null) {
    const active = await this.prisma.groupMember.findMany({ where: { businessId, status: 'ACTIVE' }, select: { id: true, name: true, costPercent: true } });
    const before = await this.prisma.groupSettings.findUnique({ where: { businessId }, select: { costSplit: true } });
    if (dto.mode === 'CUSTOM') {
      const given = new Map((dto.members ?? []).map((entry) => [entry.groupMemberId, entry.percent]));
      if (active.some((member) => !given.has(member.id)) || [...given.keys()].some((id) => !active.some((member) => member.id === id))) {
        throw new BadRequestException('Give a percent for each active member');
      }
      const total = [...given.values()].reduce((sum, value) => sum + Math.round(value * 100), 0);
      if (Math.abs(total - 10000) > 5) {
        throw new BadRequestException('The percents must add up to 100');
      }
      await this.prisma.$transaction([
        ...active.map((member) => this.prisma.groupMember.update({ where: { id: member.id }, data: { costPercent: given.get(member.id) } })),
        this.prisma.groupSettings.upsert({ where: { businessId }, update: { costSplit: 'CUSTOM' }, create: { businessId, costSplit: 'CUSTOM' } }),
      ]);
      const change = active
        .filter((member) => Number(member.costPercent ?? -1) !== given.get(member.id))
        .map((member) => ({ field: member.name, from: member.costPercent === null ? null : Number(member.costPercent), to: given.get(member.id) }));
      await this.record(businessId, actorUserId, { action: 'EDITED', entity: 'SPLIT', summary: { mode: 'CUSTOM' }, change });
    } else {
      await this.prisma.groupSettings.upsert({ where: { businessId }, update: { costSplit: 'EQUAL' }, create: { businessId, costSplit: 'EQUAL' } });
      await this.record(businessId, actorUserId, {
        action: 'EDITED',
        entity: 'SPLIT',
        summary: { mode: 'EQUAL' },
        change: [{ field: 'mode', from: before?.costSplit ?? 'EQUAL', to: 'EQUAL' }],
      });
    }
    return this.getSettings(businessId);
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
      include: { groupMember: true, receivedBy: true },
      // Same-date entries (common -- several contributions logged the same
      // day) break ties by most-recently-created first, so a correction
      // entry (e.g. a "Return Money" added right after the original
      // deposit) shows up above it instead of wherever date-only ordering
      // happens to place equal dates.
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
  }

  // "Given to": one of this group's accountants (or nobody).
  private async requireAccountant(businessId: string, id: string) {
    const member = await this.requireMember(businessId, id);
    if (member.role !== 'ACCOUNTANT') {
      throw new BadRequestException(`${member.name} isn't an accountant`);
    }
    return member;
  }

  private async cashHolderOf(businessId: string): Promise<string | null> {
    const settings = await this.prisma.groupSettings.findUnique({ where: { businessId }, select: { cashHolderMemberId: true } });
    return settings?.cashHolderMemberId ?? null;
  }

  async createContribution(businessId: string, dto: CreateGroupContributionDto, actorUserId: string | null = null) {
    const member = await this.requireMember(businessId, dto.groupMemberId);
    const kind: GroupContributionKind = dto.kind ?? (Number(dto.amount) < 0 ? 'RETURN' : 'DEPOSIT');
    if (dto.receivedByMemberId) await this.requireAccountant(businessId, dto.receivedByMemberId);
    // A deposit or a return left without a "given to" goes through the cash holder.
    const receivedByMemberId =
      dto.receivedByMemberId !== undefined ? dto.receivedByMemberId : kind === 'DEPOSIT' || kind === 'RETURN' ? await this.cashHolderOf(businessId) : null;
    const created = await this.prisma.groupContribution.create({
      data: {
        businessId,
        groupMemberId: dto.groupMemberId,
        amount: dto.amount,
        kind,
        date: new Date(dto.date),
        note: dto.note,
        receivedByMemberId,
        createdByUserId: actorUserId,
      },
      include: { groupMember: true, receivedBy: true },
    });
    await this.record(businessId, actorUserId, {
      action: 'ADDED',
      entity: 'CONTRIBUTION',
      entityId: created.id,
      summary: {
        member: member.name,
        amount: money(created.amount),
        kind,
        date: dto.date,
        receivedBy: created.receivedBy?.name ?? null,
        note: dto.note ?? null,
      },
    });
    return created;
  }

  // A payment from one member to another: the payer's SETTLE in and the
  // receiver's SETTLE out, in one commit and under one settleGroupId, so
  // Undo removes the pair. Recorded as two calls, the first could save and
  // the second fail, leaving half a payment.
  async settleUp(businessId: string, dto: SettleUpDto, actorUserId: string | null = null) {
    if (dto.fromMemberId === dto.toMemberId) {
      throw new BadRequestException('Pick two different members.');
    }
    if (!(Number(dto.amount) > 0)) {
      throw new BadRequestException('The amount must be more than zero.');
    }
    const payer = await this.requireMember(businessId, dto.fromMemberId);
    const receiver = await this.requireMember(businessId, dto.toMemberId);
    const date = new Date(dto.date);
    const settleGroupId = randomUUID();
    const rows = await this.prisma.$transaction([
      this.prisma.groupContribution.create({
        data: {
          businessId,
          groupMemberId: dto.fromMemberId,
          amount: dto.amount,
          kind: 'SETTLE',
          date,
          note: dto.payerNote,
          settleGroupId,
          createdByUserId: actorUserId,
        },
      }),
      this.prisma.groupContribution.create({
        data: {
          businessId,
          groupMemberId: dto.toMemberId,
          amount: `-${dto.amount}`,
          kind: 'SETTLE',
          date,
          note: dto.receiverNote,
          settleGroupId,
          createdByUserId: actorUserId,
        },
      }),
    ]);
    await this.record(businessId, actorUserId, {
      action: 'ADDED',
      entity: 'SETTLE',
      entityId: settleGroupId,
      summary: { from: payer.name, to: receiver.name, amount: money(dto.amount), date: dto.date },
    });
    return rows;
  }

  // Undo a settle-up: both of its rows go together.
  async undoSettleUp(businessId: string, settleGroupId: string, actorUserId: string | null = null) {
    const rows = await this.prisma.groupContribution.findMany({ where: { businessId, settleGroupId }, include: { groupMember: true } });
    if (rows.length === 0) {
      throw new NotFoundException('Payment not found');
    }
    await this.prisma.groupContribution.deleteMany({ where: { businessId, settleGroupId } });
    const payer = rows.find((row) => Number(row.amount) > 0);
    const receiver = rows.find((row) => Number(row.amount) < 0);
    await this.record(businessId, actorUserId, {
      action: 'DELETED',
      entity: 'SETTLE',
      entityId: settleGroupId,
      summary: { from: payer?.groupMember.name ?? null, to: receiver?.groupMember.name ?? null, amount: payer ? money(payer.amount) : null },
    });
    return { settleGroupId, removed: rows.length };
  }

  async updateContribution(businessId: string, id: string, dto: UpdateGroupContributionDto, actorUserId: string | null = null) {
    const current = await this.prisma.groupContribution.findUnique({ where: { id }, include: { groupMember: true, receivedBy: true } });
    if (!current || current.businessId !== businessId) {
      throw new NotFoundException('Contribution not found');
    }
    // A new amount on a deposit or a return says which it now is.
    const kind: GroupContributionKind | undefined =
      dto.kind ??
      (dto.amount !== undefined && (current.kind === 'DEPOSIT' || current.kind === 'RETURN') ? (Number(dto.amount) < 0 ? 'RETURN' : 'DEPOSIT') : undefined);
    if (dto.groupMemberId) {
      await this.requireMember(businessId, dto.groupMemberId);
    }
    if (dto.receivedByMemberId) await this.requireAccountant(businessId, dto.receivedByMemberId);
    const updated = await this.prisma.groupContribution.update({
      where: { id },
      data: {
        ...(dto.groupMemberId !== undefined && { groupMemberId: dto.groupMemberId }),
        ...(dto.amount !== undefined && { amount: dto.amount }),
        ...(kind !== undefined && { kind }),
        ...(dto.date !== undefined && { date: new Date(dto.date) }),
        ...(dto.note !== undefined && { note: dto.note }),
        ...(dto.receivedByMemberId !== undefined && { receivedByMemberId: dto.receivedByMemberId }),
      },
      include: { groupMember: true, receivedBy: true },
    });
    const change = changesOf(
      {
        member: current.groupMember.name,
        amount: money(current.amount),
        date: dayKey(current.date),
        receivedBy: current.receivedBy?.name ?? null,
        note: current.note,
      },
      {
        member: updated.groupMember.name,
        amount: money(updated.amount),
        date: dayKey(updated.date),
        receivedBy: updated.receivedBy?.name ?? null,
        note: updated.note,
      },
    );
    if (change.length > 0) {
      await this.record(businessId, actorUserId, {
        action: 'EDITED',
        entity: 'CONTRIBUTION',
        entityId: id,
        summary: { member: updated.groupMember.name, amount: money(updated.amount), kind: updated.kind, date: dayKey(updated.date) },
        change,
      });
    }
    return updated;
  }

  async deleteContribution(businessId: string, id: string, actorUserId: string | null = null) {
    const current = await this.prisma.groupContribution.findUnique({ where: { id }, include: { groupMember: true } });
    if (!current || current.businessId !== businessId) {
      throw new NotFoundException('Contribution not found');
    }
    await this.prisma.groupContribution.delete({ where: { id } });
    await this.record(businessId, actorUserId, {
      action: 'DELETED',
      entity: 'CONTRIBUTION',
      entityId: id,
      summary: { member: current.groupMember.name, amount: money(current.amount), kind: current.kind, date: dayKey(current.date) },
    });
    return { success: true };
  }

  // ---- Expense categories ----

  // Lazily seeds the defaults the first time a group's category list is
  // ever requested -- same pattern as AssetsService.listCategories() -- and
  // says how many expenses use each one (a used one can only be hidden).
  async listExpenseCategories(businessId: string) {
    let options = await this.prisma.groupExpenseCategoryOption.findMany({ where: { businessId }, orderBy: { displayOrder: 'asc' } });
    if (options.length === 0) {
      await this.prisma.groupExpenseCategoryOption.createMany({
        data: DEFAULT_EXPENSE_CATEGORIES.map((c, i) => ({
          businessId,
          name: c.name,
          icon: c.icon,
          color: c.color,
          displayOrder: i,
          ...(c.defaultSplit && { defaultSplit: c.defaultSplit }),
        })),
        skipDuplicates: true,
      });
      options = await this.prisma.groupExpenseCategoryOption.findMany({ where: { businessId }, orderBy: { displayOrder: 'asc' } });
    }
    const used = await this.prisma.groupExpense.groupBy({ by: ['category'], where: { businessId }, _count: { _all: true } });
    const counts = new Map(used.map((row) => [row.category, row._count._all]));
    return options.map((option) => ({ ...option, expenseCount: counts.get(option.name) ?? 0 }));
  }

  // New group, step 3: the family's own list in place of the defaults. Only
  // while the group has no categories yet.
  async setupExpenseCategories(businessId: string, dto: GroupCategorySetupDto, actorUserId: string | null = null) {
    if ((await this.prisma.groupExpenseCategoryOption.count({ where: { businessId } })) > 0) {
      throw new ConflictException('This group already has its categories');
    }
    const names = dto.categories.map((category) => category.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) {
      throw new BadRequestException('A category is listed twice');
    }
    const known = new Map(DEFAULT_EXPENSE_CATEGORIES.map((category) => [category.name.toLowerCase(), category]));
    await this.prisma.groupExpenseCategoryOption.createMany({
      data: dto.categories.map((category, i) => {
        const preset = known.get(category.name.trim().toLowerCase());
        return {
          businessId,
          name: category.name.trim(),
          icon: category.icon ?? preset?.icon ?? 'package',
          color: category.color ?? preset?.color ?? 'gray',
          displayOrder: i,
          defaultSplit: category.defaultSplit ?? preset?.defaultSplit ?? 'EQUAL',
        };
      }),
    });
    await this.record(businessId, actorUserId, {
      action: 'ADDED',
      entity: 'CATEGORY',
      summary: { names: dto.categories.map((category) => category.name.trim()) },
    });
    return this.listExpenseCategories(businessId);
  }

  async createExpenseCategory(businessId: string, dto: CreateGroupExpenseCategoryDto, actorUserId: string | null = null) {
    const existing = await this.prisma.groupExpenseCategoryOption.findUnique({ where: { businessId_name: { businessId, name: dto.name } } });
    if (existing) {
      throw new ConflictException(`An expense category named "${dto.name}" already exists`);
    }
    const defaultMemberIds = await this.categoryMembers(businessId, dto.defaultSplit, dto.defaultMemberIds);
    const count = await this.prisma.groupExpenseCategoryOption.count({ where: { businessId } });
    const created = await this.prisma.groupExpenseCategoryOption.create({
      data: {
        businessId,
        name: dto.name,
        icon: dto.icon,
        color: dto.color,
        displayOrder: count,
        ...(dto.defaultSplit && { defaultSplit: dto.defaultSplit }),
        ...(defaultMemberIds && { defaultMemberIds }),
        ...(dto.hidden !== undefined && { hidden: dto.hidden }),
      },
    });
    await this.record(businessId, actorUserId, { action: 'ADDED', entity: 'CATEGORY', entityId: created.id, summary: { category: created.name } });
    return created;
  }

  async updateExpenseCategory(businessId: string, id: string, dto: UpdateGroupExpenseCategoryDto, actorUserId: string | null = null) {
    const current = await this.requireExpenseCategory(businessId, id);
    // Shared another way than equally, it can't keep a chosen few.
    const leavesEqual =
      dto.defaultSplit !== undefined && dto.defaultSplit !== 'EQUAL' && dto.defaultMemberIds === undefined && current.defaultMemberIds.length > 0;
    const defaultMemberIds = leavesEqual ? [] : await this.categoryMembers(businessId, dto.defaultSplit ?? current.defaultSplit, dto.defaultMemberIds);
    if (dto.name !== undefined) {
      const clash = await this.prisma.groupExpenseCategoryOption.findUnique({ where: { businessId_name: { businessId, name: dto.name } } });
      if (clash && clash.id !== id) {
        throw new ConflictException(`An expense category named "${dto.name}" already exists`);
      }
    }
    // A renamed category takes its expenses along (they name it by its name).
    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.name !== undefined && dto.name !== current.name) {
        await tx.groupExpense.updateMany({ where: { businessId, category: current.name }, data: { category: dto.name } });
      }
      return tx.groupExpenseCategoryOption.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.icon !== undefined && { icon: dto.icon }),
          ...(dto.color !== undefined && { color: dto.color }),
          ...(dto.defaultSplit !== undefined && { defaultSplit: dto.defaultSplit }),
          ...(defaultMemberIds && { defaultMemberIds }),
          ...(dto.hidden !== undefined && { hidden: dto.hidden }),
        },
      });
    });
    const change = changesOf(
      { name: current.name, icon: current.icon, color: current.color, defaultSplit: current.defaultSplit, hidden: current.hidden },
      { name: dto.name, icon: dto.icon, color: dto.color, defaultSplit: dto.defaultSplit, hidden: dto.hidden },
    );
    if (change.length > 0)
      await this.record(businessId, actorUserId, { action: 'EDITED', entity: 'CATEGORY', entityId: id, summary: { category: updated.name }, change });
    return updated;
  }

  // A category's "Only selected" members, checked: each one of this
  // group's, and only for a category shared equally. Undefined when the
  // request didn't send any.
  private async categoryMembers(businessId: string, split: GroupSplit | undefined, memberIds: string[] | undefined): Promise<string[] | undefined> {
    if (memberIds === undefined) return undefined;
    const ids = [...new Set(memberIds)];
    if (ids.length === 0) return [];
    if (split !== undefined && split !== 'EQUAL') {
      throw new BadRequestException('Only selected members share a cost equally');
    }
    const found = await this.prisma.groupMember.count({ where: { businessId, id: { in: ids } } });
    if (found !== ids.length) {
      throw new BadRequestException("Some of those members aren't in this group");
    }
    return ids;
  }

  // A category some expense uses can only be hidden: deleting it would leave
  // those expenses under a name no list offers.
  async deleteExpenseCategory(businessId: string, id: string, actorUserId: string | null = null) {
    const category = await this.requireExpenseCategory(businessId, id);
    if ((await this.prisma.groupExpense.count({ where: { businessId, category: category.name } })) > 0) {
      throw new ConflictException("A category with expenses can't be deleted, only hidden");
    }
    await this.prisma.groupExpenseCategoryOption.delete({ where: { id } });
    await this.record(businessId, actorUserId, { action: 'DELETED', entity: 'CATEGORY', entityId: id, summary: { category: category.name } });
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

  async createExpense(businessId: string, dto: CreateGroupExpenseDto, actorUserId: string | null = null) {
    if (dto.paidByMemberId) {
      await this.requireMember(businessId, dto.paidByMemberId);
    }
    const category = dto.category ?? 'Other';
    const option = await this.prisma.groupExpenseCategoryOption.findUnique({ where: { businessId_name: { businessId, name: category } } });
    if (option?.hidden) {
      throw new BadRequestException(`${category} is hidden. Show it again in Categories to use it.`);
    }
    // Shared the way its category says, unless the expense says otherwise.
    const split = dto.split ?? option?.defaultSplit ?? 'EQUAL';
    const splits =
      dto.splits?.length || dto.split || !option?.defaultMemberIds.length ? (dto.splits ?? []) : await this.chosenMembers(businessId, option.defaultMemberIds);
    const paidFrom = dto.paidFrom ?? 'FUND';
    // Paid from the group's cash: by the accountant named (left out, the cash
    // holder). One who isn't an accountant counts as the cash holder's cash.
    const paidByMemberId = dto.paidByMemberId ?? (paidFrom === 'FUND' ? await this.cashHolderOf(businessId) : null);
    await this.checkExpense(businessId, { amount: dto.amount, paidFrom, paidByMemberId, split, splits });
    const created = await this.prisma.groupExpense.create({
      data: {
        businessId,
        amount: dto.amount,
        date: new Date(dto.date),
        category,
        description: dto.description,
        paidByMemberId,
        paidFrom,
        split,
        createdByUserId: actorUserId,
        splits: { create: splits.map((s) => ({ groupMemberId: s.groupMemberId, units: s.units ?? null, amount: s.amount ?? null })) },
      },
      include: { paidByMember: true, splits: true },
    });
    await this.record(businessId, actorUserId, {
      action: 'ADDED',
      entity: 'EXPENSE',
      entityId: created.id,
      summary: {
        category,
        amount: money(created.amount),
        date: dto.date,
        description: dto.description ?? null,
        paidBy: created.paidByMember?.name ?? null,
        paidFrom,
      },
    });
    return created;
  }

  // A category's "Only selected" members who are still in the group, as an
  // equal split; none left means everyone in the group that day.
  private async chosenMembers(businessId: string, memberIds: string[]): Promise<GroupExpenseSplitDto[]> {
    const stillHere = await this.prisma.groupMember.findMany({ where: { businessId, id: { in: memberIds }, status: 'ACTIVE' }, select: { id: true } });
    return stillHere.map((member) => ({ groupMemberId: member.id }));
  }

  async updateExpense(businessId: string, id: string, dto: UpdateGroupExpenseDto, actorUserId: string | null = null) {
    const current = await this.prisma.groupExpense.findUnique({ where: { id }, include: { splits: true, paidByMember: true } });
    if (!current || current.businessId !== businessId) {
      throw new NotFoundException('Expense not found');
    }
    if (dto.paidByMemberId) {
      await this.requireMember(businessId, dto.paidByMemberId);
    }
    if (dto.category !== undefined && dto.category !== current.category) {
      const option = await this.prisma.groupExpenseCategoryOption.findUnique({ where: { businessId_name: { businessId, name: dto.category } } });
      if (option?.hidden) throw new BadRequestException(`${dto.category} is hidden. Show it again in Categories to use it.`);
    }
    // "" clears who paid back to untracked -- see the DTO field's own comment.
    const paidByMemberId = dto.paidByMemberId !== undefined ? dto.paidByMemberId || null : current.paidByMemberId;
    const paidFrom = dto.paidFrom ?? current.paidFrom;
    await this.checkExpense(businessId, {
      amount: dto.amount ?? current.amount.toString(),
      paidFrom,
      paidByMemberId,
      split: dto.split ?? current.split,
      splits:
        dto.splits ??
        current.splits.map((s) => ({ groupMemberId: s.groupMemberId, units: s.units === null ? null : Number(s.units), amount: s.amount?.toString() ?? null })),
    });
    const updated = await this.prisma.$transaction(async (tx) => {
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
          ...(dto.splits !== undefined && {
            splits: { create: dto.splits.map((s) => ({ groupMemberId: s.groupMemberId, units: s.units ?? null, amount: s.amount ?? null })) },
          }),
        },
        include: { paidByMember: true, splits: true },
      });
    });
    const change = changesOf(
      {
        amount: money(current.amount),
        date: dayKey(current.date),
        category: current.category,
        description: current.description,
        paidBy: current.paidByMember?.name ?? null,
        paidFrom: current.paidFrom,
      },
      {
        amount: money(updated.amount),
        date: dayKey(updated.date),
        category: updated.category,
        description: updated.description,
        paidBy: updated.paidByMember?.name ?? null,
        paidFrom: updated.paidFrom,
      },
    );
    if (change.length > 0) {
      await this.record(businessId, actorUserId, {
        action: 'EDITED',
        entity: 'EXPENSE',
        entityId: id,
        summary: { category: updated.category, amount: money(updated.amount), date: dayKey(updated.date), description: updated.description },
        change,
      });
    }
    return updated;
  }

  // An expense from a pocket names whose; exact amounts add up to it; the
  // members it names are this group's, once each.
  private async checkExpense(
    businessId: string,
    expense: { amount: string; paidFrom: string; paidByMemberId: string | null; split: GroupSplit; splits: GroupExpenseSplitDto[] },
  ) {
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

  async deleteExpense(businessId: string, id: string, actorUserId: string | null = null) {
    const expense = await this.requireExpense(businessId, id);
    await this.prisma.groupExpense.delete({ where: { id } });
    await this.record(businessId, actorUserId, {
      action: 'DELETED',
      entity: 'EXPENSE',
      entityId: id,
      summary: { category: expense.category, amount: money(expense.amount), date: dayKey(expense.date), description: expense.description },
    });
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

  async createMonthBudget(businessId: string, dto: CreateGroupMonthBudgetDto, actorUserId: string | null = null) {
    const existing = await this.prisma.groupMonthlyBudget.findUnique({
      where: { businessId_month_year: { businessId, month: dto.month, year: dto.year } },
    });
    if (existing) {
      throw new ConflictException(`A budget for ${dto.month}/${dto.year} already exists`);
    }
    const created = await this.prisma.groupMonthlyBudget.create({
      data: { businessId, month: dto.month, year: dto.year, budgetAmount: dto.budgetAmount },
    });
    await this.record(businessId, actorUserId, {
      action: 'ADDED',
      entity: 'BUDGET',
      entityId: created.id,
      summary: { month: dto.month, year: dto.year, amount: money(created.budgetAmount) },
    });
    return created;
  }

  async updateMonthBudget(businessId: string, id: string, dto: UpdateGroupMonthBudgetDto, actorUserId: string | null = null) {
    const budget = await this.requireMonthBudget(businessId, id);
    if (dto.month !== undefined || dto.year !== undefined) {
      const month = dto.month ?? budget.month;
      const year = dto.year ?? budget.year;
      const clash = await this.prisma.groupMonthlyBudget.findUnique({ where: { businessId_month_year: { businessId, month, year } } });
      if (clash && clash.id !== id) {
        throw new ConflictException(`A budget for ${month}/${year} already exists`);
      }
    }
    const updated = await this.prisma.groupMonthlyBudget.update({
      where: { id },
      data: {
        ...(dto.month !== undefined && { month: dto.month }),
        ...(dto.year !== undefined && { year: dto.year }),
        ...(dto.budgetAmount !== undefined && { budgetAmount: dto.budgetAmount }),
      },
    });
    const change = changesOf({ amount: money(budget.budgetAmount) }, { amount: money(updated.budgetAmount) });
    if (change.length > 0)
      await this.record(businessId, actorUserId, {
        action: 'EDITED',
        entity: 'BUDGET',
        entityId: id,
        summary: { month: updated.month, year: updated.year },
        change,
      });
    return updated;
  }

  async deleteMonthBudget(businessId: string, id: string, actorUserId: string | null = null) {
    const budget = await this.requireMonthBudget(businessId, id);
    await this.prisma.groupMonthlyBudget.delete({ where: { id } });
    await this.record(businessId, actorUserId, {
      action: 'DELETED',
      entity: 'BUDGET',
      entityId: id,
      summary: { month: budget.month, year: budget.year, amount: money(budget.budgetAmount) },
    });
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

  // What the group spent in each of its months ("YYYY-MM", the group's own
  // months: one starting on the 10th runs 10 Sep to 9 Oct), oldest first --
  // the month picker's "Spent ৳ X" under every month.
  async monthTotals(businessId: string): Promise<{ month: string; spent: string }[]> {
    const settings = await this.prisma.groupSettings.findUnique({ where: { businessId }, select: { monthStartDay: true } });
    const shift = Math.max(0, (settings?.monthStartDay ?? 1) - 1);
    return this.prisma.$queryRaw<{ month: string; spent: string }[]>`
      SELECT to_char("date" - make_interval(days => ${shift}::int), 'YYYY-MM') AS month, SUM("amount")::text AS spent
      FROM "GroupExpense"
      WHERE "businessId" = ${businessId}
      GROUP BY 1
      ORDER BY 1`;
  }

  async getSettings(businessId: string) {
    const settings = await this.prisma.groupSettings.findUnique({ where: { businessId } });
    return settings ?? { businessId, ...DEFAULT_SETTINGS };
  }

  async updateSettings(businessId: string, dto: UpdateGroupSettingsDto, actorUserId: string | null = null) {
    const before = await this.getSettings(businessId);
    // The cash holder keeps the cash: picking a member who isn't an
    // accountant makes them one (the old mess "manager").
    if (dto.cashHolderMemberId) {
      const holder = await this.requireMember(businessId, dto.cashHolderMemberId);
      if (holder.role !== 'ACCOUNTANT') {
        await this.checkAccountants(businessId);
        await this.prisma.groupMember.update({ where: { id: holder.id }, data: { role: 'ACCOUNTANT' } });
      }
    }
    const data = {
      ...(dto.kind !== undefined && { kind: dto.kind }),
      ...(dto.monthStartDay !== undefined && { monthStartDay: dto.monthStartDay }),
      ...(dto.cashHolderMemberId !== undefined && { cashHolderMemberId: dto.cashHolderMemberId }),
      ...(dto.mealsOn !== undefined && { mealsOn: dto.mealsOn }),
      ...(dto.breakfastUnits !== undefined && { breakfastUnits: dto.breakfastUnits }),
      ...(dto.lunchUnits !== undefined && { lunchUnits: dto.lunchUnits }),
      ...(dto.dinnerUnits !== undefined && { dinnerUnits: dto.dinnerUnits }),
      ...(dto.budgetWarnPercent !== undefined && { budgetWarnPercent: dto.budgetWarnPercent }),
      ...(dto.paused !== undefined && { pausedAt: dto.paused ? (before.pausedAt ?? new Date()) : null }),
    };
    const saved = await this.prisma.groupSettings.upsert({ where: { businessId }, update: data, create: { businessId, ...data } });
    const change = changesOf(
      {
        kind: before.kind,
        monthStartDay: before.monthStartDay,
        cashHolderMemberId: before.cashHolderMemberId,
        mealsOn: before.mealsOn,
        budgetWarnPercent: before.budgetWarnPercent,
        paused: !!before.pausedAt,
      },
      {
        kind: dto.kind,
        monthStartDay: dto.monthStartDay,
        cashHolderMemberId: dto.cashHolderMemberId,
        mealsOn: dto.mealsOn,
        budgetWarnPercent: dto.budgetWarnPercent,
        paused: dto.paused,
      },
    );
    if (change.length > 0) await this.record(businessId, actorUserId, { action: 'EDITED', entity: 'SETTINGS', summary: {}, change });
    return saved;
  }

  // ---- Meals ----

  listMeals(businessId: string, filters: { from?: string; to?: string }) {
    return this.prisma.groupMeal.findMany({
      where: {
        businessId,
        ...((filters.from || filters.to) && {
          date: { ...(filters.from && { gte: new Date(filters.from) }), ...(filters.to && { lte: new Date(filters.to) }) },
        }),
      },
      orderBy: [{ date: 'asc' }],
    });
  }

  // A day's meals: each entry replaces that member's day, and one with no
  // meals at all clears it.
  async setMeals(businessId: string, dto: SetGroupMealsDto, actorUserId: string | null = null) {
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
          await tx.groupMeal.upsert({
            where: { groupMemberId_date: { groupMemberId: entry.groupMemberId, date } },
            update: meals,
            create: { businessId, groupMemberId: entry.groupMemberId, date, ...meals },
          });
        }
      }
    });
    await this.record(businessId, actorUserId, { action: 'EDITED', entity: 'MEALS', summary: { date: dto.date } });
    return this.listMeals(businessId, { from: dto.date, to: dto.date });
  }

  // ---- Cash handovers ----

  // Cash handed from one holder to another. Both must be able to keep the
  // group's cash: an accountant, or the cash holder.
  private async requireHolders(businessId: string, fromMemberId: string, toMemberId: string) {
    if (fromMemberId === toMemberId) {
      throw new BadRequestException('Pick two different people.');
    }
    const [from, to, holder] = await Promise.all([
      this.requireMember(businessId, fromMemberId),
      this.requireMember(businessId, toMemberId),
      this.cashHolderOf(businessId),
    ]);
    for (const member of [from, to]) {
      if (member.role !== 'ACCOUNTANT' && member.id !== holder) {
        throw new BadRequestException(`${member.name} doesn't keep group cash`);
      }
    }
    if (to.status !== 'ACTIVE') {
      throw new BadRequestException(`${to.name} has left the group`);
    }
    return { from, to };
  }

  async createHandover(businessId: string, dto: CreateGroupCashHandoverDto, actorUserId: string | null = null) {
    // The DTO's pattern lets "0" through; handing over nothing isn't a handover.
    if (!(Number(dto.amount) > 0)) throw new BadRequestException('The amount must be more than zero.');
    const { from, to } = await this.requireHolders(businessId, dto.fromMemberId, dto.toMemberId);
    const created = await this.prisma.groupCashHandover.create({
      data: {
        businessId,
        fromMemberId: dto.fromMemberId,
        toMemberId: dto.toMemberId,
        amount: dto.amount,
        date: new Date(dto.date),
        note: dto.note || null,
        createdByUserId: actorUserId,
      },
      include: { fromMember: true, toMember: true },
    });
    await this.record(businessId, actorUserId, {
      action: 'ADDED',
      entity: 'HANDOVER',
      entityId: created.id,
      summary: { from: from.name, to: to.name, amount: money(created.amount), date: dto.date, note: created.note },
    });
    return created;
  }

  async updateHandover(businessId: string, id: string, dto: UpdateGroupCashHandoverDto, actorUserId: string | null = null) {
    const current = await this.prisma.groupCashHandover.findUnique({ where: { id }, include: { fromMember: true, toMember: true } });
    if (!current || current.businessId !== businessId) {
      throw new NotFoundException('Handover not found');
    }
    if (dto.amount !== undefined && !(Number(dto.amount) > 0)) throw new BadRequestException('The amount must be more than zero.');
    const fromMemberId = dto.fromMemberId ?? current.fromMemberId;
    const toMemberId = dto.toMemberId ?? current.toMemberId;
    if (fromMemberId !== current.fromMemberId || toMemberId !== current.toMemberId) await this.requireHolders(businessId, fromMemberId, toMemberId);
    const updated = await this.prisma.groupCashHandover.update({
      where: { id },
      data: {
        fromMemberId,
        toMemberId,
        ...(dto.amount !== undefined && { amount: dto.amount }),
        ...(dto.date !== undefined && { date: new Date(dto.date) }),
        ...(dto.note !== undefined && { note: dto.note || null }),
      },
      include: { fromMember: true, toMember: true },
    });
    const change = changesOf(
      { from: current.fromMember.name, to: current.toMember.name, amount: money(current.amount), date: dayKey(current.date), note: current.note },
      { from: updated.fromMember.name, to: updated.toMember.name, amount: money(updated.amount), date: dayKey(updated.date), note: updated.note },
    );
    if (change.length > 0) {
      await this.record(businessId, actorUserId, {
        action: 'EDITED',
        entity: 'HANDOVER',
        entityId: id,
        summary: { from: updated.fromMember.name, to: updated.toMember.name, amount: money(updated.amount), date: dayKey(updated.date) },
        change,
      });
    }
    return updated;
  }

  async deleteHandover(businessId: string, id: string, actorUserId: string | null = null) {
    const current = await this.prisma.groupCashHandover.findUnique({ where: { id }, include: { fromMember: true, toMember: true } });
    if (!current || current.businessId !== businessId) {
      throw new NotFoundException('Handover not found');
    }
    await this.prisma.groupCashHandover.delete({ where: { id } });
    await this.record(businessId, actorUserId, {
      action: 'DELETED',
      entity: 'HANDOVER',
      entityId: id,
      summary: { from: current.fromMember.name, to: current.toMember.name, amount: money(current.amount), date: dayKey(current.date) },
    });
    return { success: true };
  }

  // ---- Cash book ----

  // An accountant's money in (deposits given to them) and out (expenses
  // they paid from it, returns they handed back), with the running cash.
  async getCashbook(businessId: string, filters: { accountantId?: string; from?: string; to?: string }) {
    if (filters.accountantId) await this.requireMember(businessId, filters.accountantId);
    const [members, contributions, expenses, holder, handovers] = await Promise.all([
      this.prisma.groupMember.findMany({ where: { businessId }, orderBy: [{ isOwner: 'desc' }, { createdAt: 'asc' }] }),
      this.prisma.groupContribution.findMany({ where: { businessId, kind: { in: ['DEPOSIT', 'RETURN'] } }, include: { groupMember: true } }),
      this.prisma.groupExpense.findMany({ where: { businessId, paidFrom: 'FUND' } }),
      this.cashHolderOf(businessId),
      this.prisma.groupCashHandover.findMany({ where: { businessId } }),
    ]);
    const moves = this.movesOf(members, contributions, expenses, holder, handovers);
    const names = new Map(members.map((member) => [member.id, member.name]));
    const book = cashbook(moves, filters);
    const cash = cashByAccountant(moves, filters.to);
    const accountants = members
      .filter((member) => member.role === 'ACCOUNTANT' || member.id === holder || cash.has(member.id))
      .map((member) => ({ groupMemberId: member.id, name: member.name, active: member.status === 'ACTIVE', cash: money(cash.get(member.id) ?? 0) }));
    return {
      accountants,
      cashHolderMemberId: holder,
      opening: money(book.opening),
      closing: money(book.closing),
      totalIn: money(book.totalIn),
      totalOut: money(book.totalOut),
      inCount: book.inCount,
      outCount: book.outCount,
      rows: book.rows.map((row) => ({ ...row, accountantName: names.get(row.accountantId) ?? null, amount: money(row.amount), balance: money(row.balance) })),
    };
  }

  private movesOf(
    members: { id: string; name: string; role: GroupMemberRole }[],
    contributions: {
      id: string;
      date: Date;
      createdAt: Date;
      kind: GroupContributionKind;
      amount: Prisma.Decimal;
      groupMemberId: string;
      groupMember: { name: string };
      receivedByMemberId: string | null;
      note: string | null;
    }[],
    expenses: {
      id: string;
      date: Date;
      createdAt: Date;
      amount: Prisma.Decimal;
      category: string;
      description: string | null;
      paidFrom: string;
      paidByMemberId: string | null;
    }[],
    holder: string | null,
    handovers: {
      id: string;
      date: Date;
      createdAt: Date;
      amount: Prisma.Decimal;
      fromMemberId: string;
      toMemberId: string;
      note: string | null;
      createdByUserId?: string | null;
    }[] = [],
  ) {
    const accountantIds = new Set(members.filter((member) => member.role === 'ACCOUNTANT').map((member) => member.id));
    const nameOf = new Map(members.map((member) => [member.id, member.name]));
    return cashMovements(
      contributions.map((row) => ({
        id: row.id,
        date: dayKey(row.date),
        createdAt: row.createdAt.getTime(),
        kind: row.kind,
        amount: Number(row.amount),
        memberId: row.groupMemberId,
        memberName: row.groupMember.name,
        receivedByMemberId: row.receivedByMemberId,
        note: row.note,
      })),
      expenses.map((row) => ({
        id: row.id,
        date: dayKey(row.date),
        createdAt: row.createdAt.getTime(),
        amount: Number(row.amount),
        category: row.category,
        description: row.description,
        paidFromFund: row.paidFrom === 'FUND',
        paidByMemberId: row.paidByMemberId,
      })),
      accountantIds,
      holder,
      handovers.map((row) => ({
        id: row.id,
        date: dayKey(row.date),
        createdAt: row.createdAt.getTime(),
        amount: Number(row.amount),
        fromMemberId: row.fromMemberId,
        fromName: nameOf.get(row.fromMemberId) ?? '',
        toMemberId: row.toMemberId,
        toName: nameOf.get(row.toMemberId) ?? '',
        note: row.note,
        createdByUserId: row.createdByUserId ?? null,
      })),
    );
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
  // closes can't both pass the overlap check. With nextBudgetAmount, the next
  // month's budget is set in the same commit ("Create November and close
  // October").
  async closeSettlement(businessId: string, dto: CloseSettlementDto, userId: string) {
    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);
    if (periodEnd.getTime() < periodStart.getTime()) {
      throw new BadRequestException('The period ends before it starts');
    }

    const closed = await this.prisma.$transaction(async (tx) => {
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
      const next = new Date(periodEnd.getTime() + DAY_MS);
      if (dto.carryForward) {
        const label = `Carried from ${dayKey(periodStart)} to ${dayKey(periodEnd)}`;
        const carried = result.members.filter((m) => Number(m.balance) !== 0);
        if (carried.length > 0) {
          await tx.groupContribution.createMany({
            data: carried.map((m) => ({ businessId, groupMemberId: m.groupMemberId, amount: m.balance, kind: 'CARRY' as const, date: next, note: label })),
          });
        }
      }

      if (dto.nextBudgetAmount !== undefined) {
        const key = { month: next.getUTCMonth() + 1, year: next.getUTCFullYear() };
        await tx.groupMonthlyBudget.upsert({
          where: { businessId_month_year: { businessId, ...key } },
          update: { budgetAmount: dto.nextBudgetAmount },
          create: { businessId, ...key, budgetAmount: dto.nextBudgetAmount },
        });
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
    await this.record(businessId, userId, {
      action: 'MONTH',
      entity: 'MONTH',
      entityId: closed.id,
      summary: {
        periodStart: dayKey(periodStart),
        periodEnd: dayKey(periodEnd),
        carriedForward: !!dto.carryForward,
        settled: closed.members.filter((member) => Number(member.balance) === 0).length,
        open: closed.members.filter((member) => Number(member.balance) !== 0).length,
        nextBudget: dto.nextBudgetAmount === undefined ? null : money(dto.nextBudgetAmount),
      },
    });
    return closed;
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
    const [members, contributions, expenses, meals, settings, cashRows, fundExpenses, handovers] = await Promise.all([
      client.groupMember.findMany({ where: { businessId }, orderBy: [{ isOwner: 'desc' }, { createdAt: 'asc' }] }),
      client.groupContribution.findMany({ where: { businessId, date: inPeriod }, select: { groupMemberId: true, amount: true } }),
      client.groupExpense.findMany({ where: { businessId, date: inPeriod }, include: { splits: true } }),
      client.groupMeal.findMany({ where: { businessId, date: inPeriod } }),
      client.groupSettings.findUnique({ where: { businessId } }),
      client.groupContribution.findMany({
        where: { businessId, kind: { in: ['DEPOSIT', 'RETURN'] }, date: { lte: periodEnd } },
        include: { groupMember: true },
      }),
      client.groupExpense.findMany({ where: { businessId, paidFrom: 'FUND', date: { lte: periodEnd } } }),
      client.groupCashHandover.findMany({ where: { businessId, date: { lte: periodEnd } } }),
    ]);
    const units = {
      breakfast: Number(settings?.breakfastUnits ?? DEFAULT_SETTINGS.breakfastUnits),
      lunch: Number(settings?.lunchUnits ?? DEFAULT_SETTINGS.lunchUnits),
      dinner: Number(settings?.dinnerUnits ?? DEFAULT_SETTINGS.dinnerUnits),
    };
    // Costs shared "by cost split" are weighted by each member's percent
    // when the split is custom, and the same for everyone when it's equal.
    const custom = settings?.costSplit === 'CUSTOM';
    const result = settleGroup({
      start: dayKey(periodStart),
      end: dayKey(periodEnd),
      members: members.map((m) => ({
        id: m.id,
        name: m.name,
        active: m.status === 'ACTIVE',
        joinedOn: m.joinedOn ? dayKey(m.joinedOn) : null,
        leftOn: m.leftOn ? dayKey(m.leftOn) : null,
        shareUnits: custom ? Number(m.costPercent ?? 0) : 1,
      })),
      contributions: contributions.map((c) => ({ memberId: c.groupMemberId, amount: Number(c.amount) })),
      expenses: expenses.map((e) => ({
        amount: Number(e.amount),
        date: dayKey(e.date),
        paidFromPocket: e.paidFrom === 'MEMBER',
        paidByMemberId: e.paidByMemberId,
        split: e.split,
        splits: e.splits.map((sp) => ({
          memberId: sp.groupMemberId,
          units: sp.units === null ? null : Number(sp.units),
          amount: sp.amount === null ? null : Number(sp.amount),
        })),
      })),
      meals: meals.map((m) => ({
        memberId: m.groupMemberId,
        units: m.breakfast * units.breakfast + m.lunch * units.lunch + m.dinner * units.dinner + Number(m.guests),
      })),
      mealsOn: settings?.mealsOn ?? false,
    });
    const holder = settings?.cashHolderMemberId ?? null;
    const cash = cashByAccountant(this.movesOf(members, cashRows, fundExpenses, holder, handovers));
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
      accountantCash: members
        .filter((member) => member.role === 'ACCOUNTANT' || member.id === holder)
        .map((member) => ({ groupMemberId: member.id, name: member.name, cash: money(cash.get(member.id) ?? 0) })),
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

  private async requireExpense(businessId: string, id: string) {
    const expense = await this.prisma.groupExpense.findUnique({ where: { id } });
    if (!expense || expense.businessId !== businessId) {
      throw new NotFoundException('Expense not found');
    }
    return expense;
  }
}
