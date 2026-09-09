import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import { Roles } from '../admin-auth/decorators/roles.decorator.js';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import { RolesGuard } from '../admin-auth/guards/roles.guard.js';
import { ListLoginAttemptsQueryDto } from './dto/list-login-attempts-query.dto.js';
import { LoginMonitoringService } from './login-monitoring.service.js';

// SUPER_ADMIN only -- see the note on AuditLogsController; login monitoring
// is just as sensitive (it can reveal which admin accounts are being
// targeted or misused).
@UseGuards(AdminAuthGuard, RolesGuard)
@Roles(AdminRole.SUPER_ADMIN)
@Controller('admin/security/login-attempts')
export class LoginMonitoringController {
  constructor(private readonly loginMonitoringService: LoginMonitoringService) {}

  @Get('summary')
  summary() {
    return this.loginMonitoringService.summary();
  }

  @Get()
  list(@Query() query: ListLoginAttemptsQueryDto) {
    return this.loginMonitoringService.list(query);
  }
}
