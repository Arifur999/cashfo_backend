import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import { Roles } from '../admin-auth/decorators/roles.decorator.js';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import { RolesGuard } from '../admin-auth/guards/roles.guard.js';
import { RevenueService } from './revenue.service.js';

@UseGuards(AdminAuthGuard, RolesGuard)
@Roles(AdminRole.SUPER_ADMIN, AdminRole.FINANCE_ADMIN)
@Controller('admin/revenue')
export class RevenueController {
  constructor(private readonly revenueService: RevenueService) {}

  @Get('summary')
  summary() {
    return this.revenueService.summary();
  }

  @Get('churn')
  churn() {
    return this.revenueService.churn();
  }
}
