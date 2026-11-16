import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { dhakaDateKey } from '../common/dhaka.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ReceivablesPayablesService } from '../receivables-payables/receivables-payables.service.js';
import { goalColorAt } from '../savings-goals/goal-colors.js';
import { SavingsGoalsService } from '../savings-goals/savings-goals.service.js';
import { MoneyFlowService } from './money-flow.service.js';
import { NetWorthService, type WorthOn } from './net-worth.service.js';

const dateOf = (day: string) => new Date(`${day}T00:00:00.000Z`);
const dayBefore = (day: string) => new Date(dateOf(day).getTime() - 86_400_000).toISOString().slice(0, 10);
const taka = (value: Prisma.Decimal | number | string | null | undefined) => Math.round(Number(value ?? 0) * 100) / 100;

// Reports' one page for a period: the net worth statement (what you owned
// and owed when the day before it ended, and at its end), where the money
// went (MoneyFlowService), and the period's savings goals, loans, assets and
// events.
// The events section for a member who may not see Calendar & Events.
const NO_EVENTS = { count: 0, given: 0, received: 0, list: [] };

@Injectable()
export class PeriodReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly receivablesPayables: ReceivablesPayablesService,
    private readonly moneyFlow: MoneyFlowService,
    private readonly savingsGoals: SavingsGoalsService,
    private readonly netWorth: NetWorthService,
  ) {}

  // `withEvents` false (a member Calendar & Events is closed to) gets the
  // events section empty: the events API refuses them its titles, places
  // and gifts, and this report must not hand them over instead.
  async report(businessId: string, from: string, to: string, now = new Date(), withEvents = true) {
    const today = dhakaDateKey(now);
    if (from > today) throw new BadRequestException('Pick a period that has begun');
    const start = dayBefore(from);
    const end = to < today ? to : today;
    const [flow, loans, worth, savings, assets, events] = await Promise.all([
      this.moneyFlow.flow(businessId, from, to, now),
      this.receivablesPayables.loanPeriod(businessId, from, to, []),
      this.netWorth.on(businessId, [start, end], today),
      this.savings(businessId, from, to),
      this.assets(businessId, from, to, end),
      withEvents ? this.events(businessId, from, to) : NO_EVENTS,
    ]);
    const worthAt = (row: WorthOn) => ({ ...row, counts: { ...row.counts, goals: savings.goalCount } });
    return {
      dateFrom: from,
      dateTo: to,
      worth: { start: worthAt(worth[0]), end: worthAt(worth[1]) },
      flow,
      savings: savings.view,
      loans: {
        lent: taka(loans.sums.GAVE),
        borrowed: taka(loans.sums.TOOK),
        gotBack: taka(loans.sums.GOT_BACK),
        repaid: taka(loans.sums.PAID_BACK),
        profitPaid: taka(loans.sums.PROFIT_PAID),
        profitReceived: taka(loans.sums.PROFIT_RECEIVED),
        entries: loans.entries.map((entry) => ({ ...entry, amount: taka(entry.amount) })),
      },
      assets: { ...assets, valueEnd: worth[1].parts.assets, countEnd: worth[1].counts.assets },
      events,
    };
  }

  private async savings(businessId: string, from: string, to: string) {
    const [goals, added, taken] = await Promise.all([
      this.savingsGoals.list(businessId),
      this.prisma.savingsGoalEntry.groupBy({
        by: ['savingsGoalId'],
        where: { businessId, type: 'CONTRIBUTION', date: { gte: dateOf(from), lt: new Date(dateOf(to).getTime() + 86_400_000) } },
        _sum: { amount: true },
      }),
      this.prisma.savingsGoalEntry.aggregate({
        where: { businessId, type: 'WITHDRAWAL', date: { gte: dateOf(from), lt: new Date(dateOf(to).getTime() + 86_400_000) } },
        _sum: { amount: true },
      }),
    ]);
    const addedTo = (id: string) => taka(added.find((row) => row.savingsGoalId === id)?._sum.amount);
    // A goal withdrawn and spent holds nothing any more.
    const open = goals.filter((goal) => goal.status !== 'WITHDRAWN');
    return {
      goalCount: open.filter((goal) => goal.status === 'ACTIVE' || goal.status === 'PAUSED').length,
      view: {
        added: taka(added.reduce((sum, row) => sum + Number(row._sum.amount ?? 0), 0)),
        takenOut: taka(taken._sum.amount),
        totalSaved: taka(open.reduce((sum, goal) => sum + Number(goal.currentAmount), 0)),
        completed: open.filter((goal) => goal.status === 'COMPLETED' && dhakaDateKey(goal.updatedAt) >= from && dhakaDateKey(goal.updatedAt) <= to).length,
        // Each goal in its card colour, its place counted in the whole list as
        // the Savings pages count it.
        goals: open
          .filter((goal) => goal.status !== 'COMPLETED' || addedTo(goal.id) > 0)
          .map((goal) => ({
            id: goal.id,
            name: goal.name,
            added: addedTo(goal.id),
            saved: taka(goal.currentAmount),
            target: taka(goal.targetAmount),
            status: goal.status,
            color: goalColorAt(goal.color, goals.indexOf(goal)),
          }))
          .sort((a, b) => b.added - a.added || b.saved - a.saved),
      },
    };
  }

  // Assets bought and sold in the period.
  private async assets(businessId: string, from: string, to: string, end: string) {
    const [bought, sold] = await Promise.all([
      this.prisma.asset.findMany({
        where: { businessId, purchaseDate: { gte: dateOf(from), lt: new Date(dateOf(to).getTime() + 86_400_000) } },
        select: { id: true, name: true, purchaseDate: true, purchasePrice: true },
      }),
      this.prisma.asset.findMany({
        where: { businessId, soldAt: { gte: dateOf(from), lt: new Date(dateOf(end).getTime() + 86_400_000) } },
        select: { id: true, name: true, soldAt: true, soldPrice: true },
      }),
    ]);
    return {
      bought: { amount: taka(bought.reduce((sum, asset) => sum + Number(asset.purchasePrice), 0)), count: bought.length },
      sold: { amount: taka(sold.reduce((sum, asset) => sum + Number(asset.soldPrice ?? 0), 0)), count: sold.length },
      entries: [
        ...bought.map((asset) => ({
          date: dhakaDateKey(asset.purchaseDate),
          assetId: asset.id,
          name: asset.name,
          kind: 'BOUGHT' as const,
          amount: taka(asset.purchasePrice),
        })),
        ...sold.map((asset) => ({
          date: dhakaDateKey(asset.soldAt as Date),
          assetId: asset.id,
          name: asset.name,
          kind: 'SOLD' as const,
          amount: taka(asset.soldPrice),
        })),
      ].sort((a, b) => b.date.localeCompare(a.date)),
    };
  }

  // The period's events, with what was given and received at each.
  private async events(businessId: string, from: string, to: string) {
    const events = await this.prisma.socialEvent.findMany({
      where: { businessId, date: { gte: dateOf(from), lte: dateOf(to) } },
      select: { id: true, title: true, type: true, date: true, time: true, place: true, gifts: { select: { direction: true, amount: true } } },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    });
    const sum = (gifts: { direction: string; amount: Prisma.Decimal }[], direction: 'GAVE' | 'GOT') =>
      taka(gifts.filter((gift) => gift.direction === direction).reduce((total, gift) => total + Number(gift.amount), 0));
    const list = events.map((event) => ({
      id: event.id,
      title: event.title,
      type: event.type,
      date: event.date.toISOString().slice(0, 10),
      time: event.time,
      place: event.place,
      gave: sum(event.gifts, 'GAVE'),
      got: sum(event.gifts, 'GOT'),
    }));
    return {
      count: list.length,
      given: taka(list.reduce((total, row) => total + row.gave, 0)),
      received: taka(list.reduce((total, row) => total + row.got, 0)),
      list,
    };
  }
}
