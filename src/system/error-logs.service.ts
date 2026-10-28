import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ErrorSource, Prisma, Severity } from '@prisma/client';
import type { ClientInfo } from '../auth/auth-sessions.service.js';
import { createdAtFilter } from '../common/time-window.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ErrorGroupsQueryDto, ResolveErrorsDto } from './dto/error-groups.dto.js';
import { ListErrorLogsQueryDto } from './dto/list-error-logs-query.dto.js';
import { CUSTOMER_APP, ReportClientErrorDto } from './dto/report-client-error.dto.js';

// A browser's User-Agent is a few hundred characters; anything longer is
// cut so a report stays as small as its own fields.
const MAX_USER_AGENT = 500;

export interface ErrorGroup {
  message: string;
  source: ErrorSource;
  // The highest severity among the group's rows.
  severity: Severity;
  count: number;
  firstAt: Date;
  lastAt: Date;
  // The newest row: its id, metadata (request, page, app) and stack trace.
  lastId: string;
  sampleMetadata: unknown;
  sampleStackTrace: string | null;
  // Every row in the group is resolved.
  resolved: boolean;
}

// The WHERE conditions of the grouped list, as SQL fragments joined with AND.
export function errorGroupConditions(query: ErrorGroupsQueryDto, now = new Date()): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [];
  if (query.resolved === 'true') conditions.push(Prisma.sql`"resolved" = true`);
  if (query.resolved === 'false') conditions.push(Prisma.sql`"resolved" = false`);
  if (query.source) conditions.push(Prisma.sql`"source" = CAST(${query.source} AS "ErrorSource")`);
  if (query.severity) conditions.push(Prisma.sql`"severity" = CAST(${query.severity} AS "Severity")`);
  if (query.digest) conditions.push(Prisma.sql`"metadata"->>'digest' = ${query.digest}`);
  if (query.app) conditions.push(Prisma.sql`"metadata"->>'app' = ${query.app}`);
  const createdAt = createdAtFilter({ within: query.within, dateFrom: query.from, dateTo: query.to }, now);
  if (createdAt?.gte) conditions.push(Prisma.sql`"createdAt" >= ${createdAt.gte}`);
  if (createdAt?.lte) conditions.push(Prisma.sql`"createdAt" <= ${createdAt.lte}`);
  return conditions;
}

// The rows "Mark all fixed" closes: still open, and matching every filter
// sent. Null when nothing names which rows, so an empty body can't close
// every error at once.
export function resolveAllWhere(dto: ResolveErrorsDto): Prisma.ErrorLogWhereInput | null {
  if (!dto.message && !dto.source && !dto.ids?.length) return null;
  return {
    resolved: false,
    ...(dto.message && { message: dto.message }),
    ...(dto.source && { source: dto.source }),
    ...(dto.ids?.length && { id: { in: dto.ids } }),
  };
}

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

  // System > Errors as the board shows it: one row per message and source,
  // newest first, a page at a time. Grouped in the database so a flood of
  // one error is still one row here.
  async groups(query: ErrorGroupsQueryDto, now = new Date()) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const conditions = errorGroupConditions(query, now);
    const where = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;

    const [rows, [{ total }]] = await Promise.all([
      this.prisma.$queryRaw<ErrorGroup[]>`
        SELECT "message", "source", MAX("severity") AS "severity", COUNT(*)::int AS "count",
          MIN("createdAt") AS "firstAt", MAX("createdAt") AS "lastAt",
          (ARRAY_AGG("id" ORDER BY "createdAt" DESC))[1] AS "lastId",
          (ARRAY_AGG("metadata" ORDER BY "createdAt" DESC))[1] AS "sampleMetadata",
          (ARRAY_AGG("stackTrace" ORDER BY "createdAt" DESC))[1] AS "sampleStackTrace",
          BOOL_AND("resolved") AS "resolved"
        FROM "ErrorLog" ${where}
        GROUP BY "message", "source"
        ORDER BY "lastAt" DESC, "message"
        LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      this.prisma.$queryRaw<
        { total: number }[]
      >`SELECT COUNT(*)::int AS "total" FROM (SELECT 1 FROM "ErrorLog" ${where} GROUP BY "message", "source") AS "groups"`,
    ]);

    return { data: rows, meta: { page, limit, total, totalPage: Math.ceil(total / limit) } };
  }

  // "Mark all 5 fixed": every open row of a group (or the rows named), with
  // one audit entry for the lot.
  async resolveAll(dto: ResolveErrorsDto, adminId: string, ipAddress?: string) {
    const where = resolveAllWhere(dto);
    if (!where) {
      throw new BadRequestException('Say which errors to mark fixed: a message, a source or ids');
    }
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.errorLog.updateMany({ where, data: { resolved: true, resolvedBy: adminId, resolvedAt: new Date() } });
      if (count > 0) {
        await tx.auditLog.create({
          data: {
            adminUserId: adminId,
            action: 'ERROR_LOGS_RESOLVED',
            entityType: 'ErrorLog',
            newValue: {
              ...(dto.message && { message: dto.message.slice(0, 500) }),
              ...(dto.source && { source: dto.source }),
              ...(dto.ids?.length && { ids: dto.ids }),
              count,
            },
            ipAddress,
          },
        });
      }
      return { resolved: count };
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
