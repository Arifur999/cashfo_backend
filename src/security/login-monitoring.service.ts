import { Injectable } from '@nestjs/common';
import { type LoginAttempt, Prisma, SuspiciousActivityType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { parseDeviceLabel } from '../user-auth/device-label.js';
import { ListLoginAttemptsQueryDto } from './dto/list-login-attempts-query.dto.js';
import { createdAtFilter } from '../common/time-window.js';
import { normalizeEmail, PAUSE_MS, pausedNetworks, SIGNED_IN_AFTER_MS, signedInAfter } from './security-extras.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const TOP_NETWORKS = 5;
// The emails a network tried, newest first, as far as the sidebar shows them.
const EMAILS_PER_NETWORK = 3;

const ACCOUNT_SELECT = { email: true, name: true, role: true, status: true } as const;

@Injectable()
export class LoginMonitoringService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListLoginAttemptsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.LoginAttemptWhereInput = {};
    if (query.email) where.email = { contains: query.email, mode: 'insensitive' };
    if (query.ipAddress) where.ipAddress = { contains: query.ipAddress };
    if (query.success === 'true') where.success = true;
    if (query.success === 'false') where.success = false;
    const createdAt = createdAtFilter(query);
    if (createdAt) where.createdAt = createdAt;

    const [attempts, total] = await Promise.all([
      this.prisma.loginAttempt.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.loginAttempt.count({ where }),
    ]);

    return { data: await this.withDetails(attempts), meta: { page, limit, total, totalPage: Math.ceil(total / limit) } };
  }

  // Each attempt with the device it came from, the account its email
  // belongs to (none for a made-up address), and, for a failure, when that
  // email next signed in.
  private async withDetails(attempts: LoginAttempt[]) {
    const emails = [...new Set(attempts.map((attempt) => normalizeEmail(attempt.email)))];
    const failures = attempts.filter((attempt) => !attempt.success);
    const failedEmails = [...new Set(failures.map((attempt) => normalizeEmail(attempt.email)))];
    const times = failures.map((attempt) => attempt.createdAt.getTime());

    const [accounts, successes] = await Promise.all([
      emails.length > 0 ? this.prisma.user.findMany({ where: { email: { in: emails } }, select: ACCOUNT_SELECT }) : [],
      failures.length > 0
        ? this.prisma.loginAttempt.findMany({
            where: {
              success: true,
              email: { in: failedEmails },
              createdAt: { gt: new Date(Math.min(...times)), lte: new Date(Math.max(...times) + SIGNED_IN_AFTER_MS) },
            },
            select: { email: true, createdAt: true },
            orderBy: { createdAt: 'asc' },
          })
        : [],
    ]);
    const accountByEmail = new Map(accounts.map(({ email, ...account }) => [email, account]));

    return attempts.map((attempt) => ({
      ...attempt,
      deviceLabel: parseDeviceLabel(attempt.userAgent),
      account: accountByEmail.get(normalizeEmail(attempt.email)) ?? null,
      signedInAt: attempt.success ? null : signedInAfter(attempt, successes),
    }));
  }

  async summary() {
    const now = Date.now();
    const last24h = new Date(now - DAY_MS);
    const last7d = new Date(now - 7 * DAY_MS);
    const failedSince = (since: Date) => ({ success: false, createdAt: { gte: since } });

    const [failedLast24h, failedLast7d, byIpToday, byIpWeek, refused] = await Promise.all([
      this.prisma.loginAttempt.count({ where: failedSince(last24h) }),
      this.prisma.loginAttempt.count({ where: failedSince(last7d) }),
      this.prisma.loginAttempt.groupBy({ by: ['ipAddress'], where: failedSince(last24h), _count: true }),
      this.prisma.loginAttempt.groupBy({ by: ['ipAddress'], where: failedSince(last7d), _count: true, _max: { createdAt: true } }),
      this.prisma.loginAttempt.findMany({
        where: { failureReason: 'rate_limited', createdAt: { gte: new Date(now - PAUSE_MS) } },
        select: { email: true, ipAddress: true, createdAt: true },
      }),
    ]);

    const busiestToday = byIpToday.reduce<{ ipAddress: string; count: number } | null>(
      (best, row) => (!best || row._count > best.count ? { ipAddress: row.ipAddress, count: row._count } : best),
      null,
    );

    return {
      failedLast24h,
      failedLast7d,
      // "9 of them from one network".
      busiestNetworkToday: busiestToday,
      paused: pausedNetworks(refused, now),
      topIps: await this.describeNetworks(
        byIpWeek
          .map((row) => ({ ipAddress: row.ipAddress, count: row._count, lastAt: row._max.createdAt }))
          .sort((a, b) => b.count - a.count)
          .slice(0, TOP_NETWORKS),
        last7d,
      ),
    };
  }

  // For the sidebar's "Most failed sign-ins": which emails each network
  // tried, whose account the newest one is, and the flag it raised, if any.
  private async describeNetworks(networks: Array<{ ipAddress: string; count: number; lastAt: Date | null }>, since: Date) {
    if (networks.length === 0) return [];
    const ips = networks.map((network) => network.ipAddress);

    const [pairs, flags] = await Promise.all([
      this.prisma.loginAttempt.groupBy({
        by: ['ipAddress', 'email'],
        where: { success: false, createdAt: { gte: since }, ipAddress: { in: ips } },
        _max: { createdAt: true },
      }),
      this.prisma.suspiciousActivityFlag.findMany({
        where: { type: SuspiciousActivityType.MULTIPLE_FAILED_LOGINS, relatedIp: { in: ips } },
        orderBy: { createdAt: 'desc' },
        select: { relatedIp: true, status: true },
      }),
    ]);

    const emailsByIp = new Map<string, string[]>();
    for (const pair of [...pairs].sort((a, b) => (b._max.createdAt?.getTime() ?? 0) - (a._max.createdAt?.getTime() ?? 0))) {
      const emails = emailsByIp.get(pair.ipAddress) ?? [];
      const email = normalizeEmail(pair.email);
      if (!emails.includes(email)) emails.push(email);
      emailsByIp.set(pair.ipAddress, emails);
    }
    const newestEmails = [...new Set(networks.map((network) => emailsByIp.get(network.ipAddress)?.[0]).filter((email): email is string => Boolean(email)))];
    const accounts = newestEmails.length > 0 ? await this.prisma.user.findMany({ where: { email: { in: newestEmails } }, select: ACCOUNT_SELECT }) : [];
    const accountByEmail = new Map(accounts.map(({ email, ...account }) => [email, account]));
    const flagByIp = new Map<string, (typeof flags)[number]['status']>();
    for (const flag of flags) {
      if (flag.relatedIp && !flagByIp.has(flag.relatedIp)) flagByIp.set(flag.relatedIp, flag.status);
    }

    return networks.map((network) => {
      const emails = emailsByIp.get(network.ipAddress) ?? [];
      return {
        ...network,
        emails: emails.slice(0, EMAILS_PER_NETWORK),
        emailCount: emails.length,
        account: emails[0] ? (accountByEmail.get(emails[0]) ?? null) : null,
        flagStatus: flagByIp.get(network.ipAddress) ?? null,
      };
    });
  }
}
