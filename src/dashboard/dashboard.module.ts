import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { AnalyticsService } from '../analytics/analytics.service.js';
import { HealthModule } from '../health/health.module.js';
import { RevenueService } from '../revenue/revenue.service.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';

// AnalyticsService and RevenueService need only the database, so the
// dashboard has its own instances rather than their modules exporting them.
// HealthModule: SystemHealthService for the System list.
@Module({
  imports: [AdminAuthModule, HealthModule],
  controllers: [DashboardController],
  providers: [DashboardService, AnalyticsService, RevenueService],
})
export class DashboardModule {}
