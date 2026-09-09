import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class BackupsService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.backupRecord.findMany({ orderBy: { startedAt: 'desc' } });
  }

  async trigger(adminId: string, ipAddress?: string) {
    const record = await this.prisma.backupRecord.create({
      data: { triggeredBy: adminId, type: 'MANUAL', status: 'IN_PROGRESS' },
    });

    await this.prisma.auditLog.create({
      data: {
        adminUserId: adminId,
        action: 'MANUAL_BACKUP_TRIGGERED',
        entityType: 'BackupRecord',
        entityId: record.id,
        ipAddress,
      },
    });

    // SIMULATED: no real pg_dump or storage upload happens here. A real
    // backup job would run out-of-process and report completion back via a
    // webhook/callback; this setTimeout stands in for that callback so the
    // record still visibly transitions IN_PROGRESS -> SUCCESS a few seconds
    // later, without this request blocking on it.
    setTimeout(() => {
      void this.completeSimulatedBackup(record.id);
    }, 3000);

    return record;
  }

  private async completeSimulatedBackup(id: string) {
    const sizeMb = Math.round((150 + Math.random() * 60) * 10) / 10;
    await this.prisma.backupRecord.update({
      where: { id },
      data: {
        status: 'SUCCESS',
        sizeMb,
        fileLocation: `s3://backups/db-${new Date().toISOString().slice(0, 10)}-manual.sql.gz`,
        completedAt: new Date(),
      },
    });
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
