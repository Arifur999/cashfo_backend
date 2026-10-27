import { Global, Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsService } from './analytics.service.js';
import { TrackingApiKeyGuard } from './guards/tracking-api-key.guard.js';
import { UsageEventsService } from './usage-events.service.js';

// Global so the features that record usage (reports, habits) can inject
// UsageEventsService without each importing this module.
@Global()
@Module({
  imports: [AdminAuthModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, TrackingApiKeyGuard, UsageEventsService],
  exports: [UsageEventsService],
})
export class AnalyticsModule {}
