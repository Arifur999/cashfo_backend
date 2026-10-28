import { Controller, Get, UseGuards } from '@nestjs/common';
import { Roles } from '../admin-auth/decorators/roles.decorator.js';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import { RolesGuard } from '../admin-auth/guards/roles.guard.js';
import { AdminRole } from '../common/roles.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SystemHealthService } from './system-health.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// System > Health and backups: the health cards (API and database, email,
// payment gateways, file storage), the last good backup, and the errors of
// the last day. SUPER_ADMIN only, like the rest of System. The public
// /health stays a bare database check that says nothing about the setup.
@UseGuards(AdminAuthGuard, RolesGuard)
@Roles(AdminRole.SUPER_ADMIN)
@Controller('admin/system/health')
export class AdminSystemHealthController {
  constructor(
    private readonly health: SystemHealthService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async status() {
    const now = new Date();
    const since = new Date(now.getTime() - DAY_MS);
    const [health, lastBackup, errors, high] = await Promise.all([
      this.health.status(),
      this.prisma.backupRecord.findFirst({
        where: { status: 'SUCCESS', completedAt: { not: null } },
        orderBy: { completedAt: 'desc' },
        select: { completedAt: true, sizeMb: true },
      }),
      this.prisma.errorLog.count({ where: { createdAt: { gte: since } } }),
      this.prisma.errorLog.count({ where: { createdAt: { gte: since }, severity: { in: ['HIGH', 'CRITICAL'] } } }),
    ]);
    return { ...health, lastBackup: lastBackup ?? null, errors24h: { count: errors, high }, checkedAt: now };
  }
}
