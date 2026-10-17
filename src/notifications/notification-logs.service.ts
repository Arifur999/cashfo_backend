import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { ListNotificationLogsQueryDto } from './dto/list-notification-logs-query.dto.js';

@Injectable()
export class NotificationLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListNotificationLogsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.NotificationLogWhereInput = {};
    if (query.platformUserId) where.platformUserId = query.platformUserId;
    if (query.channel) where.channel = query.channel;
    if (query.status) where.status = query.status;
    if (query.templateKey) where.templateKey = query.templateKey;

    const [logs, total] = await Promise.all([
      this.prisma.notificationLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.notificationLog.count({ where }),
    ]);

    const userIds = [...new Set(logs.map((l) => l.platformUserId))];
    const users = await this.prisma.platformUser.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } });
    const userById = new Map(users.map((u) => [u.id, u]));

    const data = logs.map((log) => ({ ...log, platformUser: userById.get(log.platformUserId) ?? null }));

    return { data, meta: { page, limit, total, totalPage: Math.ceil(total / limit) } };
  }

  // The last 24 hours at a glance: how many went, how many wait, how many
  // failed, and the most recent failure with who it was for.
  async stats() {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [byStatus, lastFailure] = await Promise.all([
      this.prisma.notificationLog.groupBy({ by: ['status'], where: { createdAt: { gte: since } }, _count: true }),
      this.prisma.notificationLog.findFirst({ where: { status: 'FAILED', createdAt: { gte: since } }, orderBy: { createdAt: 'desc' } }),
    ]);
    const count = (status: string) => byStatus.find((row) => row.status === status)?._count ?? 0;
    const failedFor = lastFailure ? await this.prisma.platformUser.findUnique({ where: { id: lastFailure.platformUserId }, select: { name: true } }) : null;
    return {
      sent: count('SENT'),
      queued: count('QUEUED'),
      failed: count('FAILED'),
      lastFailure: lastFailure
        ? { templateKey: lastFailure.templateKey, channel: lastFailure.channel, errorMessage: lastFailure.errorMessage, userName: failedFor?.name ?? null }
        : null,
    };
  }
}
