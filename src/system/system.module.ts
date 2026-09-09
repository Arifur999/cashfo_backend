import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { BackupsController } from './backups.controller.js';
import { BackupsService } from './backups.service.js';
import { ErrorLogsController } from './error-logs.controller.js';
import { ErrorLogsService } from './error-logs.service.js';
import { FeatureFlagsController } from './feature-flags.controller.js';
import { FeatureFlagsService } from './feature-flags.service.js';
import { RateLimitsController } from './rate-limits.controller.js';
import { RateLimitsService } from './rate-limits.service.js';

// System/Technical Management: backups, feature flags, error logs, and API
// rate-limit monitoring. This is a still-early product -- everything here is
// SIMULATED or manual-trigger rather than wired to real infrastructure:
//   - Backups: no real pg_dump/storage upload, BackupsService.trigger()
//     just simulates a job completing a few seconds later (see its comment).
//   - Feature flags: real data model + rollout-percentage logic, ready for
//     the future end-user app to call GET .../evaluate today.
//   - Error logs: real table + a real global exception filter (see
//     filters/global-exception.filter.ts) logging genuine 5xx failures;
//     nothing simulated here.
//   - Rate limits: ApiRateLimitLog is currently seed-only demonstration data
//     -- @nestjs/throttler (Prompt 1) enforces real limits in-memory but
//     doesn't persist a log; wiring it to write rows here is future work.
// Every route except feature-flags' `evaluate` and errors' `report` is
// SUPER_ADMIN only -- see the per-controller comments for why those two
// deviate from that default.
@Module({
  imports: [AdminAuthModule],
  controllers: [BackupsController, FeatureFlagsController, ErrorLogsController, RateLimitsController],
  providers: [BackupsService, FeatureFlagsService, ErrorLogsService, RateLimitsService],
  exports: [ErrorLogsService],
})
export class SystemModule {}
