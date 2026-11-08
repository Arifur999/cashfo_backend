import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { liveAt } from '../common/customer-counts.js';
import { dhakaDateKey } from '../common/dhaka.js';
import { countryOfIp } from '../common/ip-country.js';
import { END_USER_WHERE } from '../common/roles.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DateRangeQueryDto, EngagementQueryDto } from './dto/date-range-query.dto.js';
import { TrackEventDto } from './dto/track-event.dto.js';
import { classifyDeviceType, USAGE_EVENTS } from './usage-events.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
const DEFAULT_RANGE_DAYS = 30;
// A custom range is capped at a year: every day in it is a row in the
// response and a pass over the sessions, so an unbounded one could hang the
// request.
const MAX_RANGE_DAYS = 366;
// Month by month (a year, or a longer span of the period picker) a range
// may run to ten years: the sessions are still one pass.
const MAX_MONTHLY_RANGE_DAYS = 3660;
const COHORT_MONTHS = 6;

// 'YYYY-MM' of the Dhaka calendar month an instant falls in.
function monthKey(date: Date): string {
  return dhakaDateKey(date).slice(0, 7);
}

// The instant a Dhaka calendar day ('YYYY-MM-DD') begins: 18:00 UTC the day
// before.
function dhakaDayStart(day: string): Date {
  return new Date(new Date(`${day}T00:00:00.000Z`).getTime() - DHAKA_OFFSET_MS);
}

interface ResolvedRange {
  from: Date;
  toExclusive: Date;
  days: string[]; // "YYYY-MM-DD", inclusive of both ends
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  track(dto: TrackEventDto) {
    return this.prisma.usageEvent.create({
      data: { ...dto, metadata: dto.metadata as unknown as Prisma.InputJsonValue | undefined },
    });
  }

  // Real per-feature usage counts, replacing the old fully-synthetic
  // UsageEvent groupBy (that table is only ever seed-fabricated -- nothing
  // in this app's real request path ever writes to it). Each eventType maps
  // onto a real table that a genuine end-user action already creates rows
  // in, with no new instrumentation needed. account_created excludes
  // isSystemAccount rows (the auto-seeded chart of accounts) so this counts
  // only accounts a real user manually added. Viewing a report writes
  // nothing of its own, so report_viewed (and habit_checked_in) come from
  // the UsageEvent rows the server writes for them (UsageEventsService);
  // they start at zero from the release that began writing them.
  async featureUsage(query: DateRangeQueryDto) {
    const { from, toExclusive } = this.resolveRange(query, MAX_MONTHLY_RANGE_DAYS);
    const createdAt = { gte: from, lt: toExclusive };

    const [incomeAdded, expenseAdded, workspaceCreated, accountCreated, budgetCreated, login, events] = await Promise.all([
      this.prisma.transaction.count({ where: { transactionType: 'INCOME', createdAt } }),
      this.prisma.transaction.count({ where: { transactionType: 'EXPENSE', createdAt } }),
      this.prisma.business.count({ where: { createdAt } }),
      this.prisma.account.count({ where: { createdAt, isSystemAccount: false } }),
      this.prisma.budgetCategory.count({ where: { createdAt } }),
      this.prisma.userSession.count({ where: { createdAt } }),
      this.prisma.usageEvent.groupBy({
        by: ['eventType'],
        where: { eventType: { in: Object.values(USAGE_EVENTS) }, createdAt },
        _count: { _all: true },
      }),
    ]);
    const eventCount = (eventType: string) => events.find((row) => row.eventType === eventType)?._count._all ?? 0;

    return [
      { eventType: 'income_added', count: incomeAdded },
      { eventType: 'expense_added', count: expenseAdded },
      { eventType: 'workspace_created', count: workspaceCreated },
      { eventType: 'account_created', count: accountCreated },
      { eventType: 'budget_created', count: budgetCreated },
      { eventType: 'login', count: login },
      { eventType: USAGE_EVENTS.REPORT_VIEWED, count: eventCount(USAGE_EVENTS.REPORT_VIEWED) },
      { eventType: USAGE_EVENTS.HABIT_CHECKED_IN, count: eventCount(USAGE_EVENTS.HABIT_CHECKED_IN) },
    ].sort((a, b) => b.count - a.count);
  }

  // DAU still reads DailyActiveSnapshot -- there is no real daily-rollup cron
  // anywhere in this app (this used to be the "precomputed rollup a real
  // cron job would maintain", but no such job exists), so with that table's
  // seed data cleared this honestly reads 0 until real daily-aggregation
  // infrastructure is built; that's new-feature work, not a data-source
  // swap. Both DAU and WAU come from real UserSession rows: a customer is
  // active on a (Dhaka) day when one of their sessions started (a sign-in)
  // or was last used (a token refresh) that day. DailyActiveSnapshot, which
  // DAU used to read, is written by nothing, so DAU was always 0. The full
  // session set for the range (plus a 7-day lookback) is small enough to
  // pull once and compute in memory rather than issuing one query per day.
  // The figures over the Analytics page: distinct customers active (a
  // session made or used) in the last 30 and 7 days, in the 7 days before
  // those, and yesterday in Dhaka, out of every customer account.
  // The KPI row for a period of the "Choose period" picker: people active
  // in it, in the seven days up to its end against the seven before, and
  // on its last day (yesterday while it runs to today) -- out of the live
  // accounts at its end, as the Dashboard counts them.
  async periodSummary(query: DateRangeQueryDto, now: Date = new Date()) {
    const today = dhakaDateKey(now);
    const toDay = query.to && query.to < today ? query.to : today;
    const fromDay = query.from && query.from < toDay ? query.from : toDay;
    const range = this.resolveRange({ from: fromDay, to: toDay }, MAX_MONTHLY_RANGE_DAYS);
    const isNow = toDay === today;
    // The seven days counted end now while the period runs to today.
    const end = isNow ? now : range.toExclusive;
    const lastDay = isNow ? dhakaDateKey(new Date(now.getTime() - DAY_MS)) : toDay;
    const lastDayStart = dhakaDayStart(lastDay);
    const weekFrom = new Date(end.getTime() - 7 * DAY_MS);
    const twoWeeksFrom = new Date(end.getTime() - 14 * DAY_MS);
    const earliest = range.from < twoWeeksFrom ? range.from : twoWeeksFrom;

    const [sessions, accounts, first] = await Promise.all([
      this.prisma.userSession.findMany({
        where: { OR: [{ createdAt: { gte: earliest, lt: range.toExclusive } }, { lastUsedAt: { gte: earliest, lt: range.toExclusive } }] },
        select: { userId: true, createdAt: true, lastUsedAt: true },
      }),
      this.prisma.user.count({ where: liveAt(end) }),
      // The first customer: months before them have nothing to show.
      this.prisma.user.findFirst({ where: END_USER_WHERE, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    ]);
    const touches = sessions.flatMap((session) => [session.createdAt, session.lastUsedAt].map((at) => ({ userId: session.userId, at })));
    const activeIn = (from: Date, to: Date) => new Set(touches.filter((touch) => touch.at >= from && touch.at < to).map((touch) => touch.userId)).size;

    return {
      from: fromDay,
      to: toDay,
      isNow,
      lastDay,
      since: first ? dhakaDateKey(first.createdAt) : null,
      activeInPeriod: activeIn(range.from, range.toExclusive),
      activeLast7d: activeIn(weekFrom, end),
      activePrevious7d: activeIn(twoWeeksFrom, weekFrom),
      activeLastDay: activeIn(lastDayStart, new Date(lastDayStart.getTime() + DAY_MS)),
      accounts,
    };
  }

  async summary(now: Date = new Date()) {
    const nowMs = now.getTime();
    const since = new Date(nowMs - 30 * DAY_MS);
    const [sessions, totalAccounts] = await Promise.all([
      this.prisma.userSession.findMany({
        where: { OR: [{ createdAt: { gte: since } }, { lastUsedAt: { gte: since } }] },
        select: { userId: true, createdAt: true, lastUsedAt: true },
      }),
      this.prisma.user.count({ where: END_USER_WHERE }),
    ]);

    const touches = sessions.flatMap((session) => [session.createdAt, session.lastUsedAt].map((at) => ({ userId: session.userId, at })));
    const activeWhere = (keep: (at: Date) => boolean) => new Set(touches.filter((touch) => keep(touch.at)).map((touch) => touch.userId)).size;
    const between = (fromDaysAgo: number, toDaysAgo: number) => (at: Date) =>
      at.getTime() >= nowMs - fromDaysAgo * DAY_MS && at.getTime() < nowMs - toDaysAgo * DAY_MS;
    const yesterday = dhakaDateKey(new Date(nowMs - DAY_MS));

    return {
      activeLast30d: activeWhere(between(30, 0)),
      activeLast7d: activeWhere(between(7, 0)),
      activePrevious7d: activeWhere(between(14, 7)),
      activeYesterday: activeWhere((at) => dhakaDateKey(at) === yesterday),
      totalAccounts,
    };
  }

  async engagement(query: EngagementQueryDto) {
    if (query.group === 'month') return this.engagementByMonth(query);
    const { from, toExclusive, days } = this.resolveRange(query);
    const windowStart = new Date(from.getTime() - 6 * DAY_MS);
    const activeByDay = await this.activeByDay(windowStart, toExclusive);

    return days.map((day) => {
      const weekUsers = new Set<string>();
      // The day itself and the six before it.
      const dayMs = new Date(`${day}T00:00:00.000Z`).getTime();
      for (let back = 0; back < 7; back++) {
        const key = new Date(dayMs - back * DAY_MS).toISOString().slice(0, 10);
        for (const userId of activeByDay.get(key) ?? []) weekUsers.add(userId);
      }
      return { date: day, dau: activeByDay.get(day)?.size ?? 0, wau: weekUsers.size };
    });
  }

  // A year or a long span of the period picker, month by month: the people
  // active on an average day of the month (its days inside the range), and
  // everyone active in the month.
  private async engagementByMonth(query: DateRangeQueryDto) {
    const { from, toExclusive, days } = this.resolveRange(query, MAX_MONTHLY_RANGE_DAYS);
    const activeByDay = await this.activeByDay(from, toExclusive);
    const months = new Map<string, { days: number; sum: number; people: Set<string> }>();
    for (const day of days) {
      const entry = months.get(day.slice(0, 7)) ?? { days: 0, sum: 0, people: new Set<string>() };
      const people = activeByDay.get(day);
      entry.days += 1;
      entry.sum += people?.size ?? 0;
      for (const userId of people ?? []) entry.people.add(userId);
      months.set(day.slice(0, 7), entry);
    }
    return [...months].map(([month, entry]) => ({ month, avgDau: Math.round(entry.sum / entry.days), mau: entry.people.size }));
  }

  // Every (Dhaka day, customer) pair with activity: a session made or used
  // that day.
  private async activeByDay(from: Date, toExclusive: Date): Promise<Map<string, Set<string>>> {
    const sessions = await this.prisma.userSession.findMany({
      where: { OR: [{ createdAt: { gte: from, lt: toExclusive } }, { lastUsedAt: { gte: from, lt: toExclusive } }] },
      select: { userId: true, createdAt: true, lastUsedAt: true },
    });
    const activeByDay = new Map<string, Set<string>>();
    for (const session of sessions) {
      for (const at of [session.createdAt, session.lastUsedAt]) {
        if (at < from || at >= toExclusive) continue;
        const day = dhakaDateKey(at);
        let users = activeByDay.get(day);
        if (!users) {
          users = new Set();
          activeByDay.set(day, users);
        }
        users.add(session.userId);
      }
    }
    return activeByDay;
  }

  // Real signup cohorts (User.createdAt) and real monthly activity (distinct
  // UserSession.userId per month), replacing the old fake PlatformUser +
  // UsageEvent pairing.
  // With a period: the six monthly groups up to its last month (the last
  // finished month at most), as the board lists them.
  async cohorts(query: DateRangeQueryDto = {}) {
    const [users, sessions] = await Promise.all([
      this.prisma.user.findMany({ where: END_USER_WHERE, select: { id: true, createdAt: true } }),
      this.prisma.userSession.findMany({ select: { userId: true, createdAt: true } }),
    ]);

    const userActiveMonths = new Map<string, Set<string>>();
    for (const session of sessions) {
      const key = monthKey(session.createdAt);
      let months = userActiveMonths.get(session.userId);
      if (!months) {
        months = new Set();
        userActiveMonths.set(session.userId, months);
      }
      months.add(key);
    }

    const cohorts = new Map<string, string[]>();
    for (const user of users) {
      const key = monthKey(user.createdAt);
      const ids = cohorts.get(key);
      if (ids) ids.push(user.id);
      else cohorts.set(key, [user.id]);
    }

    const now = new Date();
    let keys = [...cohorts.keys()].sort();
    if (query.to) {
      const thisMonth = monthKey(now);
      const lastFinished = new Date(Date.UTC(Number(thisMonth.slice(0, 4)), Number(thisMonth.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
      const endMonth = query.to.slice(0, 7) < lastFinished ? query.to.slice(0, 7) : lastFinished;
      keys = keys.filter((key) => key <= endMonth).slice(-COHORT_MONTHS);
    }

    return keys.map((cohortMonthKey) => {
      const userIds = cohorts.get(cohortMonthKey)!;
      const [year, month] = cohortMonthKey.split('-').map(Number);
      const cohortStart = new Date(Date.UTC(year, month - 1, 1));

      const monthsSinceSignup = Array.from({ length: COHORT_MONTHS }, (_, i) => {
        const targetStart = new Date(Date.UTC(cohortStart.getUTCFullYear(), cohortStart.getUTCMonth() + i, 1));
        if (targetStart > now) return null; // this month hasn't happened yet for this cohort

        const targetKey = monthKey(targetStart);
        const activeCount = userIds.filter((id) => userActiveMonths.get(id)?.has(targetKey)).length;
        return Math.round((activeCount / userIds.length) * 1000) / 10;
      });

      return { cohortMonth: cohortMonthKey, cohortSize: userIds.length, monthsSinceSignup };
    });
  }

  // Where customers sign in from: the country of every sign-in's address
  // (UserSession, recorded at each customer sign-in), looked up offline.
  // eventCount is sign-ins, userCount distinct customers. totalUsers is the
  // distinct customers across every country, Unknown included: someone seen
  // in two countries is in both their userCounts but counts once here.
  // Country level only: a city database is many times the size and much
  // less accurate, so cities stays empty.
  // With a period: the sessions made or used in it, so the people counted
  // are the period's active people.
  async geography(query: DateRangeQueryDto = {}) {
    const sessions = await this.prisma.userSession.findMany({ where: this.touchedIn(query), select: { userId: true, ipAddress: true } });

    const byCountry = new Map<string, { eventCount: number; userIds: Set<string> }>();
    const everyone = new Set<string>();
    for (const session of sessions) {
      const country = countryOfIp(session.ipAddress);
      const entry = byCountry.get(country) ?? { eventCount: 0, userIds: new Set<string>() };
      entry.eventCount += 1;
      entry.userIds.add(session.userId);
      byCountry.set(country, entry);
      everyone.add(session.userId);
    }

    const countries = [...byCountry.entries()]
      .map(([country, v]) => ({ country, eventCount: v.eventCount, userCount: v.userIds.size }))
      // Places first, most customers first; the addresses no country claims last.
      .sort((a, b) => Number(a.country === 'Unknown') - Number(b.country === 'Unknown') || b.userCount - a.userCount || b.eventCount - a.eventCount);

    return { countries, totalUsers: everyone.size, cities: [] as { city: string; country: string; eventCount: number; userCount: number }[] };
  }

  // Real device signal -- classifies every real UserSession.userAgent
  // (already captured at real login time) instead of grouping fake
  // UsageEvent.deviceType rows.
  // With a period: the sign-ins made in it.
  async devices(query: DateRangeQueryDto = {}) {
    const range = query.from || query.to ? this.resolveRange(query, MAX_MONTHLY_RANGE_DAYS) : null;
    const sessions = await this.prisma.userSession.findMany({
      where: range ? { createdAt: { gte: range.from, lt: range.toExclusive } } : undefined,
      select: { userAgent: true },
    });

    const counts = new Map<'MOBILE' | 'DESKTOP' | 'TABLET', number>();
    for (const session of sessions) {
      const deviceType = classifyDeviceType(session.userAgent);
      counts.set(deviceType, (counts.get(deviceType) ?? 0) + 1);
    }

    const total = sessions.length;
    return [...counts.entries()]
      .map(([deviceType, count]) => ({
        deviceType,
        count,
        percentage: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.count - a.count);
  }

  // Days are Dhaka calendar days ('YYYY-MM-DD'); from/to are the
  // instants the first day begins and the day after the last one begins.
  // Sessions made or used in a period (every session without one).
  private touchedIn(query: DateRangeQueryDto): Prisma.UserSessionWhereInput | undefined {
    if (!query.from && !query.to) return undefined;
    const { from, toExclusive } = this.resolveRange(query, MAX_MONTHLY_RANGE_DAYS);
    return { OR: [{ createdAt: { gte: from, lt: toExclusive } }, { lastUsedAt: { gte: from, lt: toExclusive } }] };
  }

  private resolveRange(query: DateRangeQueryDto, maxDays = MAX_RANGE_DAYS): ResolvedRange {
    const toDay = query.to ?? dhakaDateKey(new Date());
    const toMidnightUtc = new Date(`${toDay}T00:00:00.000Z`).getTime();
    const fromDay = query.from ?? new Date(toMidnightUtc - (DEFAULT_RANGE_DAYS - 1) * DAY_MS).toISOString().slice(0, 10);
    const fromMidnightUtc = new Date(`${fromDay}T00:00:00.000Z`).getTime();

    if (fromMidnightUtc > toMidnightUtc) {
      throw new BadRequestException('"from" must be on or before "to"');
    }
    if ((toMidnightUtc - fromMidnightUtc) / DAY_MS + 1 > maxDays) {
      throw new BadRequestException(maxDays === MAX_RANGE_DAYS ? `Pick a range of at most ${maxDays} days` : 'Pick a range of at most ten years');
    }

    const days: string[] = [];
    for (let t = fromMidnightUtc; t <= toMidnightUtc; t += DAY_MS) {
      days.push(new Date(t).toISOString().slice(0, 10));
    }

    return { from: dhakaDayStart(fromDay), toExclusive: new Date(dhakaDayStart(toDay).getTime() + DAY_MS), days };
  }
}
