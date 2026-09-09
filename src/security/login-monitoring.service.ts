import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { ListLoginAttemptsQueryDto } from './dto/list-login-attempts-query.dto.js';

const DAY_MS = 24 * 60 * 60 * 1000;

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
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {
        ...(query.dateFrom && { gte: new Date(query.dateFrom) }),
        ...(query.dateTo && { lte: new Date(query.dateTo) }),
      };
    }

    const [attempts, total] = await Promise.all([
      this.prisma.loginAttempt.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.loginAttempt.count({ where }),
    ]);

    return { data: attempts, meta: { page, limit, total, totalPage: Math.ceil(total / limit) } };
  }

  async summary() {
    const now = Date.now();
    const last24h = new Date(now - DAY_MS);
    const last7d = new Date(now - 7 * DAY_MS);
    const last15min = new Date(now - 15 * 60 * 1000);

    const [failedLast24h, failedLast7d, failedByIp, failedByEmailRecent] = await Promise.all([
      this.prisma.loginAttempt.count({ where: { success: false, createdAt: { gte: last24h } } }),
      this.prisma.loginAttempt.count({ where: { success: false, createdAt: { gte: last7d } } }),
      this.prisma.loginAttempt.groupBy({ by: ['ipAddress'], where: { success: false, createdAt: { gte: last7d } }, _count: true }),
      this.prisma.loginAttempt.groupBy({ by: ['email'], where: { success: false, createdAt: { gte: last15min } }, _count: true }),
    ]);

    const topIps = failedByIp
      .map((r) => ({ ipAddress: r.ipAddress, count: r._count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // "Locked out" mirrors the login route's own throttle window/threshold
    // (5 attempts / 15 minutes -- see AdminAuthController's @Throttle())
    // rather than reaching into ThrottlerStorage's internal keys, which
    // aren't meant to be queried from an unrelated service. Same effective
    // condition, derived from the LoginAttempt audit trail instead.
    const lockedOutAccounts = failedByEmailRecent.filter((r) => r._count >= 5).length;

    return { failedLast24h, failedLast7d, topIps, lockedOutAccounts };
  }
}
