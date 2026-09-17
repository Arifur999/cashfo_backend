import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import { Roles } from '../admin-auth/decorators/roles.decorator.js';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import { RolesGuard } from '../admin-auth/guards/roles.guard.js';
import { BackupsService } from './backups.service.js';

// SUPER_ADMIN only, entire controller -- this is operational/technical and
// shouldn't be visible to Support/Finance/Content admins (see system.module.ts).
@UseGuards(AdminAuthGuard, RolesGuard)
@Roles(AdminRole.SUPER_ADMIN)
@Controller('admin/system/backups')
export class BackupsController {
  constructor(private readonly backupsService: BackupsService) {}

  @Get('status-summary')
  statusSummary() {
    return this.backupsService.statusSummary();
  }

  @Get()
  list() {
    return this.backupsService.list();
  }

  @Post('trigger')
  trigger() {
    return this.backupsService.trigger();
  }
}
