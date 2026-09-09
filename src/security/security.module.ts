import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { LoginMonitoringController } from './login-monitoring.controller.js';
import { LoginMonitoringService } from './login-monitoring.service.js';
import { SuspiciousActivityController } from './suspicious-activity.controller.js';
import { SuspiciousActivityService } from './suspicious-activity.service.js';

// This is the most sensitive module in the panel: everything under it
// (audit logs, login monitoring, suspicious-activity flags) is restricted to
// SUPER_ADMIN only at the controller level, so no other admin role -- even
// SUPPORT_ADMIN or FINANCE_ADMIN -- can browse another admin's activity or
// cover for one another.
@Module({
  imports: [AdminAuthModule],
  controllers: [LoginMonitoringController, SuspiciousActivityController],
  providers: [LoginMonitoringService, SuspiciousActivityService],
})
export class SecurityModule {}
