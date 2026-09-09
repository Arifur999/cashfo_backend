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
}
