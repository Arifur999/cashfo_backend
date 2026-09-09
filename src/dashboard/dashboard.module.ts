import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';

@Module({
  imports: [AdminAuthModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
