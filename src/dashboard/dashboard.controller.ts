import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator.js';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import type { RequestAdminUser } from '../admin-auth/interfaces/request-admin-user.interface.js';
import { DashboardService } from './dashboard.service.js';

// No role restriction beyond auth -- every role sees the dashboard, just
// with role-appropriate sections (see DashboardService.summary()).
@UseGuards(AdminAuthGuard)
@Controller('admin/dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  summary(@CurrentAdmin() admin: RequestAdminUser) {
    return this.dashboardService.summary(admin.role);
  }
}
