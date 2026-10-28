import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator.js';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import type { RequestAdminUser } from '../admin-auth/interfaces/request-admin-user.interface.js';
import { DashboardService } from './dashboard.service.js';
import { DashboardQueryDto } from './dto/dashboard-query.dto.js';

// No role restriction beyond auth -- every role sees the dashboard, just
// with role-appropriate sections (see DashboardService.summary()).
@UseGuards(AdminAuthGuard)
@Controller('admin/dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  summary(@CurrentAdmin() admin: RequestAdminUser, @Query() query: DashboardQueryDto) {
    return this.dashboardService.summary(admin, query.period);
  }
}
