import { Injectable, NotFoundException } from '@nestjs/common';
import { FlagStatus, Prisma, SuspiciousActivityType } from '@prisma/client';
import { ADMIN_USER_WHERE } from '../common/roles.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ListFlagsQueryDto } from './dto/list-flags-query.dto.js';
import { UpdateFlagDto } from './dto/update-flag.dto.js';
import { failedSignInsDescription, type KnownAccount, normalizeEmail } from './security-extras.js';

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const FAILED_ATTEMPT_THRESHOLD = 5;

// Raised and not yet closed: what the Security tabs count as needing a look.
const NEEDS_A_LOOK: FlagStatus[] = [FlagStatus.OPEN, FlagStatus.REVIEWING];

// The audit action a check writes; the newest one is "Last checked".
export const SECURITY_CHECK_ACTION = 'SECURITY_CHECK_RUN';

@Injectable()
export class SuspiciousActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListFlagsQueryDto) {
    const where: Prisma.SuspiciousActivityFlagWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.severity) where.severity = query.severity;

    const flags = await this.prisma.suspiciousActivityFlag.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });

    const adminIds = [...new Set([...flags.map((f) => f.relatedAdminId), ...flags.map((f) => f.reviewedBy)].filter((id): id is string => Boolean(id)))];
    const admins = await this.prisma.user.findMany({ where: { id: { in: adminIds }, ...ADMIN_USER_WHERE }, select: { id: true, name: true } });
    const adminById = new Map(admins.map((a) => [a.id, a]));

    return flags.map((flag) => ({
      ...flag,
      relatedAdmin: flag.relatedAdminId ? (adminById.get(flag.relatedAdminId) ?? null) : null,
      reviewer: flag.reviewedBy ? (adminById.get(flag.reviewedBy) ?? null) : null,
    }));
  }

  // The count on the "Suspicious activity" tab and the "Last checked" time
  // beside "Check now".
  async summary() {
    const [needsLook, lastCheck] = await Promise.all([
      this.prisma.suspiciousActivityFlag.count({ where: { status: { in: NEEDS_A_LOOK } } }),
      this.prisma.auditLog.findFirst({ where: { action: SECURITY_CHECK_ACTION }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    ]);
    return { needsLook, lastCheckedAt: lastCheck?.createdAt ?? null };
  }

  async updateStatus(id: string, dto: UpdateFlagDto, reviewerId: string, ipAddress?: string) {
    const flag = await this.prisma.suspiciousActivityFlag.findUnique({ where: { id } });
    if (!flag) {
      throw new NotFoundException('Flag not found');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.suspiciousActivityFlag.update({
        where: { id },
        data: { status: dto.status, reviewedBy: reviewerId, reviewedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          adminUserId: reviewerId,
          action: 'SECURITY_FLAG_UPDATED',
          entityType: 'SuspiciousActivityFlag',
          entityId: id,
          oldValue: { status: flag.status },
          newValue: { status: updated.status },
          ipAddress,
        },
      });
      return updated;
    });
  }

  // Manually-triggerable stand-in for a real cron job: scans failed logins
  // from the last 15 minutes, groups by IP, and flags any IP with 5+
  // failures -- skipping IPs that already have a matching flag raised within
  // the last hour so re-running this doesn't spam duplicate flags. Each run
  // is written to the audit log, which is where "Last checked" comes from.
  async runDetection(adminId: string, ipAddress?: string) {
    const fifteenMinAgo = new Date(Date.now() - FIFTEEN_MINUTES_MS);
    const oneHourAgo = new Date(Date.now() - ONE_HOUR_MS);

    const recentFailures = await this.prisma.loginAttempt.findMany({
      where: { success: false, createdAt: { gte: fifteenMinAgo } },
      select: { ipAddress: true, email: true },
    });

    const byIp = new Map<string, { count: number; emails: Set<string> }>();
    for (const attempt of recentFailures) {
      const seen = byIp.get(attempt.ipAddress) ?? { count: 0, emails: new Set<string>() };
      seen.count += 1;
      seen.emails.add(normalizeEmail(attempt.email));
      byIp.set(attempt.ipAddress, seen);
    }

    const suspiciousIps = [...byIp.entries()].filter(([, seen]) => seen.count >= FAILED_ATTEMPT_THRESHOLD);
    const triedEmails = [...new Set(suspiciousIps.flatMap(([, seen]) => [...seen.emails]))];
    const accounts: Map<string, KnownAccount> = new Map(
      triedEmails.length > 0
        ? (
            await this.prisma.user.findMany({ where: { email: { in: triedEmails } }, select: { email: true, name: true, role: true, status: true } })
          ).map((account) => [account.email, account])
        : [],
    );

    let flagsCreated = 0;
    for (const [ip, seen] of suspiciousIps) {
      const existing = await this.prisma.suspiciousActivityFlag.findFirst({
        where: { type: SuspiciousActivityType.MULTIPLE_FAILED_LOGINS, relatedIp: ip, createdAt: { gte: oneHourAgo } },
      });
      if (existing) continue;

      await this.prisma.suspiciousActivityFlag.create({
        data: {
          type: SuspiciousActivityType.MULTIPLE_FAILED_LOGINS,
          description: failedSignInsDescription(ip, seen.count, [...seen.emails], accounts),
          relatedIp: ip,
          severity: 'HIGH',
          status: 'OPEN',
        },
      });
      flagsCreated++;
    }

    const result = { scanned: recentFailures.length, ipsOverThreshold: suspiciousIps.length, flagsCreated };
    const check = await this.prisma.auditLog.create({
      data: { adminUserId: adminId, action: SECURITY_CHECK_ACTION, entityType: 'SuspiciousActivityFlag', newValue: result, ipAddress },
      select: { createdAt: true },
    });
    return { ...result, checkedAt: check.createdAt };
  }
}
