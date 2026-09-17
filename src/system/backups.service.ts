import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class BackupsService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.backupRecord.findMany({ orderBy: { startedAt: 'desc' } });
  }

  // There is no real pg_dump/storage-upload automation wired up anywhere in
  // this app -- this used to fake a MANUAL BackupRecord that flipped from
  // IN_PROGRESS to SUCCESS after a setTimeout, which would mislead an admin
  // into believing a real backup had run. Until real backup automation
  // exists, this honestly refuses rather than fabricating a success record.
  trigger(): never {
    throw new NotImplementedException(
      'Real backup automation is not wired up yet -- no pg_dump/storage upload runs anywhere in this app.',
    );
  }

  async statusSummary() {
    const thirtyDaysAgo = new Date(Date.now() - THIRTY_DAYS_MS);

    const [lastSuccess, recentRecords] = await Promise.all([
      this.prisma.backupRecord.findFirst({ where: { status: 'SUCCESS' }, orderBy: { completedAt: 'desc' } }),
      this.prisma.backupRecord.findMany({
        where: { startedAt: { gte: thirtyDaysAgo }, status: { not: 'IN_PROGRESS' } },
        select: { status: true },
      }),
    ]);

    const daysSinceLastBackup = lastSuccess?.completedAt
      ? Math.floor((Date.now() - lastSuccess.completedAt.getTime()) / (24 * 60 * 60 * 1000))
      : null;

    const successCount = recentRecords.filter((r) => r.status === 'SUCCESS').length;
    const successRate30d = recentRecords.length > 0 ? Math.round((successCount / recentRecords.length) * 1000) / 10 : null;

    return {
      lastSuccessfulBackupAt: lastSuccess?.completedAt ?? null,
      daysSinceLastBackup,
      successRate30d,
    };
  }
}
