import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createdAtFilter } from '../common/time-window.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { withEntityLabels } from './audit-entity-labels.js';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto.js';

@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListAuditLogsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.AuditLogWhereInput = {};
    if (query.adminUserId) where.adminUserId = query.adminUserId;
    if (query.entityType) where.entityType = query.entityType;
    if (query.action) where.action = query.action;
    const createdAt = createdAtFilter(query);
    if (createdAt) where.createdAt = createdAt;
    // The impersonation-logging convention (Prompt 2) marks sensitive entries
    // with `newValue.sensitive === true` -- this is the only place that
    // convention is read back out, so keep it in sync if it ever changes.
    if (query.sensitiveOnly === 'true') {
      where.newValue = { path: ['sensitive'], equals: true };
    }

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: { adminUser: { select: { id: true, name: true, role: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { data: await withEntityLabels(this.prisma, logs), meta: { page, limit, total, totalPage: Math.ceil(total / limit) } };
  }

  async getById(id: string) {
    const log = await this.prisma.auditLog.findUnique({
      where: { id },
      include: { adminUser: { select: { id: true, name: true, role: true } } },
    });
    if (!log) {
      throw new NotFoundException('Audit log entry not found');
    }
    const [labelled] = await withEntityLabels(this.prisma, [log]);
    return labelled;
  }
}
