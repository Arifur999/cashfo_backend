import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsService } from './analytics.service.js';
import { TrackingApiKeyGuard } from './guards/tracking-api-key.guard.js';

@Module({
  imports: [AdminAuthModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, TrackingApiKeyGuard],
})
export class AnalyticsModule {}
