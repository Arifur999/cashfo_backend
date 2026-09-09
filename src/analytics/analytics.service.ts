import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { DateRangeQueryDto } from './dto/date-range-query.dto.js';
import { TrackEventDto } from './dto/track-event.dto.js';

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

  async featureUsage(query: DateRangeQueryDto) {
    const { from, toExclusive } = this.resolveRange(query);

    const rows = await this.prisma.usageEvent.groupBy({
      by: ['eventType'],
      where: { createdAt: { gte: from, lt: toExclusive } },
      _count: true,
    });

    return rows.map((r) => ({ eventType: r.eventType, count: r._count })).sort((a, b) => b.count - a.count);
  }

  // DAU comes straight from DailyActiveSnapshot -- it's the precomputed,
  // stable rollup a real daily cron job would maintain, so reading it is both
  // simpler and cheaper than re-deriving distinct-user counts from raw events
  // on every request. WAU has no equivalent snapshot table (the schema for
  // this prompt only defines a daily one), so it's derived on the fly from
  // UsageEvent: for each day, count distinct platformUserId over the trailing
  // 7-day window. The full event set for the range (plus a 7-day lookback) is
  // small enough (a few thousand rows) to pull once and compute in memory
  // rather than issuing one query per day.
  async engagement(query: DateRangeQueryDto) {
    const { from, toExclusive, days } = this.resolveRange(query);
    const windowStart = new Date(from.getTime() - 6 * DAY_MS);

    const [snapshots, events] = await Promise.all([
      this.prisma.dailyActiveSnapshot.findMany({
        where: { date: { gte: from, lt: toExclusive } },
        select: { date: true, dailyActive: true },
      }),
      this.prisma.usageEvent.findMany({
        where: { createdAt: { gte: windowStart, lt: toExclusive } },
        select: { platformUserId: true, createdAt: true },
      }),
    ]);

    const dauByDate = new Map(snapshots.map((s) => [s.date.toISOString().slice(0, 10), s.dailyActive]));

    return days.map((day) => {
      const dayEndMs = new Date(`${day}T00:00:00.000Z`).getTime() + DAY_MS;
      const windowStartMs = dayEndMs - 7 * DAY_MS;
      const activeUsers = new Set<string>();
      for (const event of events) {
        const t = event.createdAt.getTime();
        if (t >= windowStartMs && t < dayEndMs) activeUsers.add(event.platformUserId);
      }
      return { date: day, dau: dauByDate.get(day) ?? 0, wau: activeUsers.size };
    });
  }

  async cohorts() {
    const [users, events] = await Promise.all([
      this.prisma.platformUser.findMany({ select: { id: true, createdAt: true } }),
      this.prisma.usageEvent.findMany({ select: { platformUserId: true, createdAt: true } }),
    ]);

    const userActiveMonths = new Map<string, Set<string>>();
    for (const event of events) {
      const key = monthKey(event.createdAt);
      let months = userActiveMonths.get(event.platformUserId);
      if (!months) {
        months = new Set();
        userActiveMonths.set(event.platformUserId, months);
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

  async devices() {
    const rows = await this.prisma.usageEvent.groupBy({ by: ['deviceType'], _count: true });
    const total = rows.reduce((sum, r) => sum + r._count, 0);

    return rows
      .map((r) => ({
        deviceType: r.deviceType,
        count: r._count,
        percentage: total > 0 ? Math.round((r._count / total) * 1000) / 10 : 0,
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
