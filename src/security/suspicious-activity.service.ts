import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SuspiciousActivityType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { ListFlagsQueryDto } from './dto/list-flags-query.dto.js';
import { UpdateFlagDto } from './dto/update-flag.dto.js';

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const FAILED_ATTEMPT_THRESHOLD = 5;

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

    const adminIds = [
      ...new Set([...flags.map((f) => f.relatedAdminId), ...flags.map((f) => f.reviewedBy)].filter((id): id is string => Boolean(id))),
    ];
    const admins = await this.prisma.adminUser.findMany({ where: { id: { in: adminIds } }, select: { id: true, name: true } });
    const adminById = new Map(admins.map((a) => [a.id, a]));

    return flags.map((flag) => ({
      ...flag,
      relatedAdmin: flag.relatedAdminId ? (adminById.get(flag.relatedAdminId) ?? null) : null,
      reviewer: flag.reviewedBy ? (adminById.get(flag.reviewedBy) ?? null) : null,
    }));
  }

  async updateStatus(id: string, dto: UpdateFlagDto, reviewerId: string) {
    const flag = await this.prisma.suspiciousActivityFlag.findUnique({ where: { id } });
    if (!flag) {
      throw new NotFoundException('Flag not found');
    }

    return this.prisma.suspiciousActivityFlag.update({
      where: { id },
      data: { status: dto.status, reviewedBy: reviewerId, reviewedAt: new Date() },
    });
  }

  // Manually-triggerable stand-in for a real cron job: scans failed logins
  // from the last 15 minutes, groups by IP, and flags any IP with 5+
  // failures -- skipping IPs that already have a matching flag raised within
  // the last hour so re-running this doesn't spam duplicate flags.
  async runDetection() {
    const fifteenMinAgo = new Date(Date.now() - FIFTEEN_MINUTES_MS);
    const oneHourAgo = new Date(Date.now() - ONE_HOUR_MS);

    const recentFailures = await this.prisma.loginAttempt.findMany({
      where: { success: false, createdAt: { gte: fifteenMinAgo } },
      select: { ipAddress: true },
    });

    const countByIp = new Map<string, number>();
    for (const attempt of recentFailures) {
      countByIp.set(attempt.ipAddress, (countByIp.get(attempt.ipAddress) ?? 0) + 1);
    }

    const suspiciousIps = [...countByIp.entries()].filter(([, count]) => count >= FAILED_ATTEMPT_THRESHOLD);

    let flagsCreated = 0;
    for (const [ip, count] of suspiciousIps) {
      const existing = await this.prisma.suspiciousActivityFlag.findFirst({
        where: { type: SuspiciousActivityType.MULTIPLE_FAILED_LOGINS, relatedIp: ip, createdAt: { gte: oneHourAgo } },
      });
      if (existing) continue;

      await this.prisma.suspiciousActivityFlag.create({
        data: {
          type: SuspiciousActivityType.MULTIPLE_FAILED_LOGINS,
          description: `${count} failed login attempts from ${ip} within 15 minutes.`,
          relatedIp: ip,
          severity: 'HIGH',
          status: 'OPEN',
        },
      });
      flagsCreated++;
    }

    return { scanned: recentFailures.length, ipsOverThreshold: suspiciousIps.length, flagsCreated };
  }
}
