import { isIP } from 'node:net';
import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import geoip from 'geoip-country';
import { dhakaDateKey } from '../common/dhaka.js';
import { END_USER_WHERE } from '../common/roles.js';
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

// The country an IP address is in, by name, from the GeoLite2 country
// database bundled with geoip-country (no network call). "Unknown" for an
// address it can't place: a private network, a test client, anything that
// isn't an IP at all.
export function countryOfIp(ipAddress: string | null): string {
  if (!ipAddress) return 'Unknown';
  // How an IPv4 client can appear on a dual-stack socket.
  const address = ipAddress.startsWith('::ffff:') ? ipAddress.slice('::ffff:'.length) : ipAddress;
  if (!isIP(address)) return 'Unknown';
  return geoip.lookup(address)?.name ?? 'Unknown';
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
const DEFAULT_RANGE_DAYS = 30;
// A custom range is capped at a year: every day in it is a row in the
// response and a pass over the sessions, so an unbounded one could hang the
// request.
const MAX_RANGE_DAYS = 366;
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
  // swap. Both DAU and WAU come from real UserSession rows: a customer is
  // active on a (Dhaka) day when one of their sessions started (a sign-in)
  // or was last used (a token refresh) that day. DailyActiveSnapshot, which
  // DAU used to read, is written by nothing, so DAU was always 0. The full
  // session set for the range (plus a 7-day lookback) is small enough to
  // pull once and compute in memory rather than issuing one query per day.
  async engagement(query: DateRangeQueryDto) {
    const { from, toExclusive, days } = this.resolveRange(query);
    const windowStart = new Date(from.getTime() - 6 * DAY_MS);

    const sessions = await this.prisma.userSession.findMany({
      where: {
        OR: [{ createdAt: { gte: windowStart, lt: toExclusive } }, { lastUsedAt: { gte: windowStart, lt: toExclusive } }],
      },
      select: { userId: true, createdAt: true, lastUsedAt: true },
    });

    // Every (Dhaka day, user) pair with activity.
    const activeByDay = new Map<string, Set<string>>();
    for (const session of sessions) {
      for (const at of [session.createdAt, session.lastUsedAt]) {
        const day = dhakaDateKey(at);
        let users = activeByDay.get(day);
        if (!users) {
          users = new Set();
          activeByDay.set(day, users);
        }
        users.add(session.userId);
      }
    }

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

  // Real signup cohorts (User.createdAt) and real monthly activity (distinct
  // UserSession.userId per month), replacing the old fake PlatformUser +
  // UsageEvent pairing.
  async cohorts() {
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

    return [...cohorts.keys()].sort().map((cohortMonthKey) => {
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
  // eventCount is sign-ins, userCount distinct customers. Country level
  // only: a city database is many times the size and much less accurate,
  // so cities stays empty.
  async geography() {
    const sessions = await this.prisma.userSession.findMany({ select: { userId: true, ipAddress: true } });

    const byCountry = new Map<string, { eventCount: number; userIds: Set<string> }>();
    for (const session of sessions) {
      const country = countryOfIp(session.ipAddress);
      const entry = byCountry.get(country) ?? { eventCount: 0, userIds: new Set<string>() };
      entry.eventCount += 1;
      entry.userIds.add(session.userId);
      byCountry.set(country, entry);
    }

    const countries = [...byCountry.entries()]
      .map(([country, v]) => ({ country, eventCount: v.eventCount, userCount: v.userIds.size }))
      // Places first, most customers first; the addresses no country claims last.
      .sort((a, b) => Number(a.country === 'Unknown') - Number(b.country === 'Unknown') || b.userCount - a.userCount || b.eventCount - a.eventCount);

    return { countries, cities: [] as { city: string; country: string; eventCount: number; userCount: number }[] };
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

  // Days are Dhaka calendar days ('YYYY-MM-DD'); from/to are the
  // instants the first day begins and the day after the last one begins.
  private resolveRange(query: DateRangeQueryDto): ResolvedRange {
    const toDay = query.to ?? dhakaDateKey(new Date());
    const toMidnightUtc = new Date(`${toDay}T00:00:00.000Z`).getTime();
    const fromDay = query.from ?? new Date(toMidnightUtc - (DEFAULT_RANGE_DAYS - 1) * DAY_MS).toISOString().slice(0, 10);
    const fromMidnightUtc = new Date(`${fromDay}T00:00:00.000Z`).getTime();

    if (fromMidnightUtc > toMidnightUtc) {
      throw new BadRequestException('"from" must be on or before "to"');
    }
    if ((toMidnightUtc - fromMidnightUtc) / DAY_MS + 1 > MAX_RANGE_DAYS) {
      throw new BadRequestException(`Pick a range of at most ${MAX_RANGE_DAYS} days`);
    }

    const days: string[] = [];
    for (let t = fromMidnightUtc; t <= toMidnightUtc; t += DAY_MS) {
      days.push(new Date(t).toISOString().slice(0, 10));
    }

    return { from: dhakaDayStart(fromDay), toExclusive: new Date(dhakaDayStart(toDay).getTime() + DAY_MS), days };
  }
}
