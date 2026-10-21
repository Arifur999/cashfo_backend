import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { dhakaDayStart } from '../common/dhaka.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ListRateLimitsQueryDto } from './dto/list-rate-limits-query.dto.js';

@Injectable()
export class RateLimitsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListRateLimitsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.ApiRateLimitLogWhereInput = {};
    if (query.limitExceeded === 'true') where.limitExceeded = true;
    if (query.limitExceeded === 'false') where.limitExceeded = false;
    if (query.endpoint) where.endpoint = query.endpoint;

    const [logs, total] = await Promise.all([
      this.prisma.apiRateLimitLog.findMany({ where, orderBy: { windowStart: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.apiRateLimitLog.count({ where }),
    ]);

    return { data: logs, meta: { page, limit, total, totalPage: Math.ceil(total / limit) } };
  }

  async summary() {
    // "Today" is the Asia/Dhaka calendar day, as everywhere else in the app:
    // from Dhaka midnight (18:00 UTC the evening before). UTC's midnight is
    // 6am in Dhaka, so "today" used to run from 6am to 6am.
    const startOfToday = dhakaDayStart();

    const [byEndpoint, exceededToday, topOffendersRaw] = await Promise.all([
      this.prisma.apiRateLimitLog.groupBy({ by: ['endpoint'], _sum: { requestCount: true } }),
      this.prisma.apiRateLimitLog.count({ where: { limitExceeded: true, windowStart: { gte: startOfToday } } }),
      this.prisma.apiRateLimitLog.groupBy({ by: ['identifier', 'identifierType'], where: { limitExceeded: true }, _count: true }),
    ]);

    const topEndpoints = byEndpoint
      .map((r) => ({ endpoint: r.endpoint, requestCount: r._sum.requestCount ?? 0 }))
      .sort((a, b) => b.requestCount - a.requestCount)
      .slice(0, 5);

    const topOffenders = topOffendersRaw
      .map((r) => ({ identifier: r.identifier, identifierType: r.identifierType, count: r._count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return { topEndpoints, exceededToday, topOffenders };
  }
}
