import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator.js';
import { Roles } from '../admin-auth/decorators/roles.decorator.js';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import { RolesGuard } from '../admin-auth/guards/roles.guard.js';
import type { RequestAdminUser } from '../admin-auth/interfaces/request-admin-user.interface.js';
import { ListFlagsQueryDto } from './dto/list-flags-query.dto.js';
import { UpdateFlagDto } from './dto/update-flag.dto.js';
import { SuspiciousActivityService } from './suspicious-activity.service.js';

// SUPER_ADMIN only -- see the note on AuditLogsController.
@UseGuards(AdminAuthGuard, RolesGuard)
@Roles(AdminRole.SUPER_ADMIN)
@Controller('admin/security/flags')
export class SuspiciousActivityController {
  constructor(private readonly suspiciousActivityService: SuspiciousActivityService) {}

  @Get()
  list(@Query() query: ListFlagsQueryDto) {
    return this.suspiciousActivityService.list(query);
  }

  @Patch(':id')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateFlagDto, @CurrentAdmin() admin: RequestAdminUser) {
    return this.suspiciousActivityService.updateStatus(id, dto, admin.id);
  }

  @Post('run-detection')
  runDetection() {
    return this.suspiciousActivityService.runDetection();
  }
}
