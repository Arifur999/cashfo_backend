import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateGroupContributionDto } from './dto/create-group-contribution.dto.js';
import type { CreateGroupExpenseDto } from './dto/create-group-expense.dto.js';
import type { CreateGroupCashHandoverDto, UpdateGroupCashHandoverDto } from './dto/group-cash-handover.dto.js';
import type { SettleUpDto } from './dto/settle-up.dto.js';
import type { UpdateGroupContributionDto } from './dto/update-group-contribution.dto.js';
import type { UpdateGroupExpenseDto } from './dto/update-group-expense.dto.js';

const NOT_YOURS = 'You can change only the entries you added yourself.';

// What an Editor -- a group member with Editor access, BusinessMember role
// ACCOUNTANT -- may do with money entries. The owner (Admin) records for
// anyone; an Editor works only in their own name:
// - a contribution is their own deposit, an expense is one they paid
//   (from the cash they hold or their own pocket), a cash handover hands
//   over their own cash, a settle-up payment is one they made;
// - they change or delete only the entries they added;
// - nothing in a closed month, and nothing while the group is paused.
// The controller runs these before the service for an ACCOUNTANT caller.
@Injectable()
export class GroupEditorRules {
  constructor(private readonly prisma: PrismaService) {}

  async contribution(businessId: string, userId: string, dto: CreateGroupContributionDto): Promise<void> {
    const self = await this.self(businessId, userId);
    if (dto.groupMemberId !== self) throw new ForbiddenException('You can add contributions only in your own name.');
    if ((dto.kind ?? 'DEPOSIT') !== 'DEPOSIT' || !(Number(dto.amount) > 0)) throw new ForbiddenException('You can add only your own deposits.');
    await this.open(businessId, [dto.date]);
  }

  async contributionChange(businessId: string, userId: string, id: string, dto?: UpdateGroupContributionDto): Promise<void> {
    const self = await this.self(businessId, userId);
    const row = await this.prisma.groupContribution.findFirst({
      where: { id, businessId },
      select: { createdByUserId: true, date: true, settleGroupId: true },
    });
    if (!row) throw new NotFoundException('Contribution not found');
    if (row.createdByUserId !== userId || row.settleGroupId) throw new ForbiddenException(NOT_YOURS);
    if (dto?.groupMemberId !== undefined && dto.groupMemberId !== self) throw new ForbiddenException('You can add contributions only in your own name.');
    if (dto?.kind !== undefined && dto.kind !== 'DEPOSIT') throw new ForbiddenException('You can add only your own deposits.');
    if (dto?.amount !== undefined && !(Number(dto.amount) > 0)) throw new ForbiddenException('You can add only your own deposits.');
    await this.open(businessId, [row.date, dto?.date]);
  }

  async settleUp(businessId: string, userId: string, dto: SettleUpDto): Promise<void> {
    const self = await this.self(businessId, userId);
    if (dto.fromMemberId !== self) throw new ForbiddenException('You can record only payments you made.');
    await this.open(businessId, [dto.date]);
  }

  async settleUpUndo(businessId: string, userId: string, settleGroupId: string): Promise<void> {
    await this.self(businessId, userId);
    const rows = await this.prisma.groupContribution.findMany({ where: { businessId, settleGroupId }, select: { createdByUserId: true, date: true } });
    if (rows.length === 0) throw new NotFoundException('Payment not found');
    if (rows.some((row) => row.createdByUserId !== userId)) throw new ForbiddenException(NOT_YOURS);
    await this.open(
      businessId,
      rows.map((row) => row.date),
    );
  }

  async expense(businessId: string, userId: string, dto: CreateGroupExpenseDto): Promise<void> {
    const self = await this.self(businessId, userId);
    if (dto.paidByMemberId !== self) throw new ForbiddenException('You can add expenses only in your own name.');
    await this.open(businessId, [dto.date]);
  }

  async expenseChange(businessId: string, userId: string, id: string, dto?: UpdateGroupExpenseDto): Promise<void> {
    const self = await this.self(businessId, userId);
    const row = await this.prisma.groupExpense.findFirst({ where: { id, businessId }, select: { createdByUserId: true, date: true } });
    if (!row) throw new NotFoundException('Expense not found');
    if (row.createdByUserId !== userId) throw new ForbiddenException(NOT_YOURS);
    if (dto?.paidByMemberId !== undefined && dto.paidByMemberId !== self) throw new ForbiddenException('You can add expenses only in your own name.');
    await this.open(businessId, [row.date, dto?.date]);
  }

  async handover(businessId: string, userId: string, dto: CreateGroupCashHandoverDto): Promise<void> {
    const self = await this.self(businessId, userId);
    if (dto.fromMemberId !== self) throw new ForbiddenException('You can hand over only your own cash.');
    await this.open(businessId, [dto.date]);
  }

  async handoverChange(businessId: string, userId: string, id: string, dto?: UpdateGroupCashHandoverDto): Promise<void> {
    const self = await this.self(businessId, userId);
    const row = await this.prisma.groupCashHandover.findFirst({ where: { id, businessId }, select: { createdByUserId: true, date: true } });
    if (!row) throw new NotFoundException('Handover not found');
    if (row.createdByUserId !== userId) throw new ForbiddenException(NOT_YOURS);
    if (dto?.fromMemberId !== undefined && dto.fromMemberId !== self) throw new ForbiddenException('You can hand over only your own cash.');
    await this.open(businessId, [row.date, dto?.date]);
  }

  // The member record the Editor signs in as. Editor access is the
  // Accountant role on it; anything else here is a stale membership.
  private async self(businessId: string, userId: string): Promise<string> {
    const member = await this.prisma.groupMember.findFirst({ where: { businessId, userId, status: 'ACTIVE' }, select: { id: true, role: true } });
    if (!member || member.role !== 'ACCOUNTANT') throw new ForbiddenException('You do not have permission to do this');
    return member.id;
  }

  // Not while the group is paused, and not on a day a closed month covers.
  private async open(businessId: string, days: (Date | string | null | undefined)[]): Promise<void> {
    const settings = await this.prisma.groupSettings.findUnique({ where: { businessId }, select: { pausedAt: true } });
    if (settings?.pausedAt) throw new ForbiddenException('This group is paused. Ask the admin to resume it.');
    const dates = days.filter((day): day is Date | string => !!day).map((day) => (typeof day === 'string' ? new Date(day.slice(0, 10)) : day));
    if (dates.length === 0) return;
    const closed = await this.prisma.groupSettlement.findFirst({
      where: { businessId, OR: dates.map((date) => ({ periodStart: { lte: date }, periodEnd: { gte: date } })) },
      select: { id: true },
    });
    if (closed) throw new ForbiddenException('That month is closed. Ask the admin to reopen it.');
  }
}
