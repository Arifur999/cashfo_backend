import { Injectable, NotFoundException } from '@nestjs/common';
import { ErrorSource, Prisma, Severity } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { ListErrorLogsQueryDto } from './dto/list-error-logs-query.dto.js';

interface ReportErrorInput {
  source: ErrorSource;
  message: string;
  stackTrace?: string;
  severity: Severity;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class ErrorLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListErrorLogsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.ErrorLogWhereInput = {};
    if (query.source) where.source = query.source;
    if (query.severity) where.severity = query.severity;
    if (query.resolved === 'true') where.resolved = true;
    if (query.resolved === 'false') where.resolved = false;
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {
        ...(query.dateFrom && { gte: new Date(query.dateFrom) }),
        ...(query.dateTo && { lte: new Date(query.dateTo) }),
      };
    }

    const [logs, total] = await Promise.all([
      this.prisma.errorLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.errorLog.count({ where }),
    ]);

    return { data: logs, meta: { page, limit, total, totalPage: Math.ceil(total / limit) } };
  }

  // Called both from the HTTP POST route (admin frontend error boundary) and
  // directly (DI, no HTTP round trip) from GlobalExceptionFilter for
  // unhandled backend exceptions.
  report(input: ReportErrorInput) {
    return this.prisma.errorLog.create({
      data: { ...input, metadata: input.metadata as unknown as Prisma.InputJsonValue | undefined },
    });
  }

  async resolve(id: string, adminId: string) {
    const log = await this.prisma.errorLog.findUnique({ where: { id } });
    if (!log) {
      throw new NotFoundException('Error log not found');
    }
    return this.prisma.errorLog.update({
      where: { id },
      data: { resolved: true, resolvedBy: adminId, resolvedAt: new Date() },
    });
  }
}
