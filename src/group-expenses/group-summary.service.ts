import { Injectable } from '@nestjs/common';
import type { GroupKind } from '@prisma/client';
import { unlockTokens, WorkspaceUnlockService } from '../business-access/workspace-unlock.service.js';
import { dhakaToday } from '../common/dhaka.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { GroupExpensesService } from './group-expenses.service.js';
import { collectedOf, contributedBy, currentGroupMonth, groupMonthPeriod, monthKeyText, owing, parseMonthKey, type MonthKey } from './group-summary.js';

export interface LockedGroupSummary {
  businessId: string;
  name: string;
  locked: true;
}

export interface GroupSummary {
  businessId: string;
  name: string;
  locked: false;
  kind: GroupKind;
  // The group month these figures are for, and its days.
  month: string;
  periodStart: string;
  periodEnd: string;
  // Members still in the group, and their shares added up.
  memberCount: number;
  shareUnits: string;
  // Money in (net of returns), spent, and the cash in hand (in less what
  // was paid from the fund).
  collected: string;
  spent: string;
  balance: string;
  // Meal counting on: the month's meal units and rate. Otherwise null.
  mealUnits: string | null;
  mealRate: string | null;
  // The even share of everything spent (null with nobody sharing).
  perHead: string | null;
  // The month's budget, if one was set.
  budget: string | null;
  // Who still has to pay, and how much in all.
  toSettle: { count: number; total: string; names: string[] };
  // How many sharing members put money in this month ("6 of 8 paid").
  contributedBy: { count: number; of: number };
  // The month is over / a closed settlement covers it.
  ended: boolean;
  closed: boolean;
  // Paused groups are kept out of new entries and listed last.
  paused: boolean;
  // The group's first month with any record ("Since Jan 2025"), or null.
  firstMonth: string | null;
}

type Today = { year: number; month: number; day: number };

const dayKey = (date: Date) => date.toISOString().slice(0, 10);
const pad = (n: number) => String(n).padStart(2, '0');

// The group list's cards: every GROUP workspace the customer is an active
// member of, with one month's figures from the same settlement maths as the
// group's own month view. A PIN-locked group stays shut here too -- only its
// name comes back -- unless the request carries its unlock: the
// x-workspace-unlock header may hold several unlocks, comma-separated, since
// one list covers many groups.
@Injectable()
export class GroupSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly groups: GroupExpensesService,
    private readonly unlocks: WorkspaceUnlockService,
  ) {}

  async summary(user: RequestUser, month: string | undefined, unlockHeader: string | string[] | undefined) {
    const tokens = unlockTokens(unlockHeader);
    const memberships = await this.prisma.businessMember.findMany({
      where: { userId: user.id, status: 'ACTIVE', business: { type: 'GROUP', deletedAt: null } },
      include: { business: { select: { id: true, name: true, pinHash: true } } },
      orderBy: { business: { createdAt: 'asc' } },
    });
    const today = dhakaToday();
    const asked = month ? parseMonthKey(month) : null;

    const groups: (GroupSummary | LockedGroupSummary)[] = [];
    for (const { business } of memberships) {
      if (this.unlocks.isShut(user, business, tokens)) {
        groups.push({ businessId: business.id, name: business.name, locked: true });
        continue;
      }
      groups.push(await this.groupMonth(business.id, business.name, asked, today));
    }
    return { month: month ?? monthKeyText(today), groups };
  }

  private async groupMonth(businessId: string, name: string, asked: MonthKey | null, today: Today): Promise<GroupSummary> {
    const settings = await this.groups.getSettings(businessId);
    const key = asked ?? currentGroupMonth(today, settings.monthStartDay);
    const { periodStart, periodEnd } = groupMonthPeriod(key, settings.monthStartDay);
    const [settlement, members, budget, closing, firstContribution, firstExpense] = await Promise.all([
      this.groups.getSettlement(businessId, dayKey(periodStart), dayKey(periodEnd)),
      this.prisma.groupMember.findMany({ where: { businessId, status: 'ACTIVE' }, select: { shareUnits: true } }),
      this.prisma.groupMonthlyBudget.findUnique({
        where: { businessId_month_year: { businessId, month: key.month, year: key.year } },
        select: { budgetAmount: true },
      }),
      this.prisma.groupSettlement.findFirst({ where: { businessId, periodStart: { lte: periodEnd }, periodEnd: { gte: periodStart } }, select: { id: true } }),
      this.prisma.groupContribution.findFirst({ where: { businessId }, orderBy: { date: 'asc' }, select: { date: true } }),
      this.prisma.groupExpense.findFirst({ where: { businessId }, orderBy: { date: 'asc' }, select: { date: true } }),
    ]);
    const first = [firstContribution?.date, firstExpense?.date].filter((date): date is Date => !!date).sort((a, b) => a.getTime() - b.getTime())[0];
    const mealsOn = settings.mealsOn && Number(settlement.mealUnits) > 0;
    return {
      businessId,
      name,
      locked: false,
      kind: settings.kind,
      month: monthKeyText(key),
      periodStart: dayKey(periodStart),
      periodEnd: dayKey(periodEnd),
      memberCount: members.length,
      shareUnits: members.reduce((sum, member) => sum + Number(member.shareUnits), 0).toFixed(2),
      collected: collectedOf(settlement.members),
      spent: settlement.totalExpense,
      balance: settlement.cashInHand,
      mealUnits: mealsOn ? settlement.mealUnits : null,
      mealRate: mealsOn ? Number(settlement.mealRate).toFixed(2) : null,
      perHead: settlement.memberCount > 0 ? settlement.perMemberShare : null,
      budget: budget ? budget.budgetAmount.toFixed(2) : null,
      toSettle: owing(settlement.members),
      ended: dayKey(periodEnd) < `${today.year}-${pad(today.month)}-${pad(today.day)}`,
      closed: closing !== null,
      contributedBy: contributedBy(settlement.members),
      paused: !!settings.pausedAt,
      firstMonth: first ? dayKey(first).slice(0, 7) : null,
    };
  }
}
