import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { DateRangeQueryDto } from './dto/date-range-query.dto.js';
import { TrackEventDto } from './dto/track-event.dto.js';

// Best-effort MOBILE/DESKTOP/TABLET classifier for the Device Breakdown
// chart -- reuses the same real UserSession.userAgent signal already parsed
// (in more detail) by user-auth/device-label.ts for Settings > Security's
// own Device Management list, rather than a separate fake DeviceType column.
function classifyDeviceType(userAgent: string | null): 'MOBILE' | 'DESKTOP' | 'TABLET' {
  if (!userAgent) return 'DESKTOP';
  if (/iPad|Tablet/i.test(userAgent)) return 'TABLET';
  if (/Mobile|Android|iPhone/i.test(userAgent)) return 'MOBILE';
  return 'DESKTOP';
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RANGE_DAYS = 30;
const COHORT_MONTHS = 6;

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
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
  // only accounts a real user manually added. "report_viewed" has no
  // persisted equivalent anywhere (viewing a report writes nothing) and is
  // intentionally omitted rather than shown as a permanent fake zero.
  async featureUsage(query: DateRangeQueryDto) {
    const { from, toExclusive } = this.resolveRange(query);
    const createdAt = { gte: from, lt: toExclusive };

    const [incomeAdded, expenseAdded, workspaceCreated, accountCreated, budgetCreated, login] = await Promise.all([
      this.prisma.transaction.count({ where: { transactionType: 'INCOME', createdAt } }),
      this.prisma.transaction.count({ where: { transactionType: 'EXPENSE', createdAt } }),
      this.prisma.business.count({ where: { createdAt } }),
      this.prisma.account.count({ where: { createdAt, isSystemAccount: false } }),
      this.prisma.budgetCategory.count({ where: { createdAt } }),
      this.prisma.userSession.count({ where: { createdAt } }),
    ]);

    return [
      { eventType: 'income_added', count: incomeAdded },
      { eventType: 'expense_added', count: expenseAdded },
      { eventType: 'workspace_created', count: workspaceCreated },
      { eventType: 'account_created', count: accountCreated },
      { eventType: 'budget_created', count: budgetCreated },
      { eventType: 'login', count: login },
    ].sort((a, b) => b.count - a.count);
  }

  // DAU still reads DailyActiveSnapshot -- there is no real daily-rollup cron
  // anywhere in this app (this used to be the "precomputed rollup a real
  // cron job would maintain", but no such job exists), so with that table's
  // seed data cleared this honestly reads 0 until real daily-aggregation
  // infrastructure is built; that's new-feature work, not a data-source
  // swap. WAU is rewired onto real UserSession rows (one per real login) --
  // for each day, distinct userId over the trailing 7-day window. The full
  // session set for the range (plus a 7-day lookback) is small enough to
  // pull once and compute in memory rather than issuing one query per day.
  async engagement(query: DateRangeQueryDto) {
    const { from, toExclusive, days } = this.resolveRange(query);
    const windowStart = new Date(from.getTime() - 6 * DAY_MS);

    const [snapshots, sessions] = await Promise.all([
      this.prisma.dailyActiveSnapshot.findMany({
        where: { date: { gte: from, lt: toExclusive } },
        select: { date: true, dailyActive: true },
      }),
      this.prisma.userSession.findMany({
        where: { createdAt: { gte: windowStart, lt: toExclusive } },
        select: { userId: true, createdAt: true },
      }),
    ]);

    const dauByDate = new Map(snapshots.map((s) => [s.date.toISOString().slice(0, 10), s.dailyActive]));

    return days.map((day) => {
      const dayEndMs = new Date(`${day}T00:00:00.000Z`).getTime() + DAY_MS;
      const windowStartMs = dayEndMs - 7 * DAY_MS;
      const activeUsers = new Set<string>();
      for (const session of sessions) {
        const t = session.createdAt.getTime();
        if (t >= windowStartMs && t < dayEndMs) activeUsers.add(session.userId);
      }
      return { date: day, dau: dauByDate.get(day) ?? 0, wau: activeUsers.size };
    });
  }

  // Real signup cohorts (User.createdAt) and real monthly activity (distinct
  // UserSession.userId per month), replacing the old fake PlatformUser +
  // UsageEvent pairing.
  async cohorts() {
    const [users, sessions] = await Promise.all([
      this.prisma.user.findMany({ select: { id: true, createdAt: true } }),
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

    return [...cohorts.keys()]
      .sort()
      .map((cohortMonthKey) => {
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

  // No real equivalent exists anywhere in this app -- no model captures a
  // real User's or real UserSession's country/city (UserSession.ipAddress is
  // stored but never geocoded, and no IP-geolocation library/service is
  // wired in). Left reading UsageEvent on purpose: with that table's seed
  // data cleared this honestly returns empty until real IP geolocation is
  // built, rather than fabricating a stand-in metric.
  async geography() {
    const events = await this.prisma.usageEvent.findMany({
      select: { platformUserId: true, country: true, city: true },
    });

    const byCountry = new Map<string, { eventCount: number; userIds: Set<string> }>();
    const byCity = new Map<string, { country: string; eventCount: number; userIds: Set<string> }>();

    for (const event of events) {
      const country = event.country ?? 'Unknown';
      const countryEntry = byCountry.get(country) ?? { eventCount: 0, userIds: new Set<string>() };
      countryEntry.eventCount += 1;
      countryEntry.userIds.add(event.platformUserId);
      byCountry.set(country, countryEntry);

      if (event.city) {
        const cityEntry = byCity.get(event.city) ?? { country, eventCount: 0, userIds: new Set<string>() };
        cityEntry.eventCount += 1;
        cityEntry.userIds.add(event.platformUserId);
        byCity.set(event.city, cityEntry);
      }
    }

    const countries = [...byCountry.entries()]
      .map(([country, v]) => ({ country, eventCount: v.eventCount, userCount: v.userIds.size }))
      .sort((a, b) => b.userCount - a.userCount);

    const cities = [...byCity.entries()]
      .map(([city, v]) => ({ city, country: v.country, eventCount: v.eventCount, userCount: v.userIds.size }))
      .sort((a, b) => b.userCount - a.userCount);

    return { countries, cities };
  }

  // Real device signal -- classifies every real UserSession.userAgent
  // (already captured at real login time) instead of grouping fake
  // UsageEvent.deviceType rows.
  async devices() {
    const sessions = await this.prisma.userSession.findMany({ select: { userAgent: true } });

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

  private resolveRange(query: DateRangeQueryDto): ResolvedRange {
    const toDate = query.to ? new Date(query.to) : new Date();
    toDate.setUTCHours(0, 0, 0, 0);
    const toExclusive = new Date(toDate.getTime() + DAY_MS);

    const fromDate = query.from ? new Date(query.from) : new Date(toDate.getTime() - (DEFAULT_RANGE_DAYS - 1) * DAY_MS);
    fromDate.setUTCHours(0, 0, 0, 0);

    const days: string[] = [];
    for (let t = fromDate.getTime(); t < toExclusive.getTime(); t += DAY_MS) {
      days.push(new Date(t).toISOString().slice(0, 10));
    }

    return { from: fromDate, toExclusive, days };
  }
}
