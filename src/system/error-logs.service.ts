import { Injectable, NotFoundException } from '@nestjs/common';
import { ErrorSource, Prisma, Severity } from '@prisma/client';
import type { ClientInfo } from '../auth/auth-sessions.service.js';
import { createdAtFilter } from '../common/time-window.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ListErrorLogsQueryDto } from './dto/list-error-logs-query.dto.js';
import { CUSTOMER_APP, ReportClientErrorDto } from './dto/report-client-error.dto.js';

// A browser's User-Agent is a few hundred characters; anything longer is
// cut so a report stays as small as its own fields.
const MAX_USER_AGENT = 500;

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
    const createdAt = createdAtFilter(query);
    if (createdAt) where.createdAt = createdAt;
    // Fields inside metadata: the reference an error screen showed, which
    // tells apart crashes that share production's one generic Server
    // Components message, and the app that sent the report. Both are paths
    // on the one metadata column, so each is its own condition under AND.
    const inMetadata: Prisma.ErrorLogWhereInput[] = [];
    if (query.digest) inMetadata.push({ metadata: { path: ['digest'], equals: query.digest } });
    if (query.app) inMetadata.push({ metadata: { path: ['app'], equals: query.app } });
    if (inMetadata.length) where.AND = inMetadata;

    const [logs, total] = await Promise.all([
      this.prisma.errorLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.errorLog.count({ where }),
    ]);

    return { data: logs, meta: { page, limit, total, totalPage: Math.ceil(total / limit) } };
  }

  // Called from the HTTP POST route (admin frontend error boundary), from
  // reportCustomerError below (the customer app's), and directly (DI, no
  // HTTP round trip) from GlobalExceptionFilter for unhandled backend
  // exceptions.
  report(input: ReportErrorInput) {
    return this.prisma.errorLog.create({
      data: { ...input, metadata: input.metadata as unknown as Prisma.InputJsonValue | undefined },
    });
  }

  // The customer app's error screen (POST /api/client-errors), so the
  // reference it shows has a row behind it. Written like the admin panel's
  // reports (a MEDIUM frontend error), marked metadata.app = 'customer', with
  // the customer, their address and their browser recorded the way
  // LoginAttempt rows record them.
  reportCustomerError(userId: string, dto: ReportClientErrorDto, client: ClientInfo) {
    // Only the path: a query string can carry a token (a reset link's
    // ?token=...), the same reason the exception filter logs request.path.
    const path = dto.path?.split(/[?#]/, 1)[0];
    return this.report({
      source: 'ADMIN_FRONTEND',
      severity: 'MEDIUM',
      message: dto.message,
      metadata: {
        app: CUSTOMER_APP,
        userId,
        ipAddress: client.ipAddress ?? 'unknown',
        ...(client.userAgent && { userAgent: client.userAgent.slice(0, MAX_USER_AGENT) }),
        ...(dto.digest && { digest: dto.digest }),
        ...(path && { path }),
      },
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
