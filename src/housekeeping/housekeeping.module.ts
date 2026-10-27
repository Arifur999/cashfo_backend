import { Global, Module } from '@nestjs/common';
import { HousekeepingScheduler } from './housekeeping.scheduler.js';

// Global so any module can register a job (HousekeepingScheduler.register)
// without importing this one.
@Global()
@Module({
  providers: [HousekeepingScheduler],
  exports: [HousekeepingScheduler],
})
export class HousekeepingModule {}
