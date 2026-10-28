import { Injectable, type OnModuleInit } from '@nestjs/common';
import { HousekeepingScheduler } from '../housekeeping/housekeeping.scheduler.js';
import { SuspiciousActivityService } from './suspicious-activity.service.js';

const FIVE_MINUTES = 5 * 60 * 1000;

// Security > Suspicious activity's checks (many failed sign-ins, a sign-in
// from a new country) on the five-minute timer, so flags appear without an
// admin pressing "Check now". Both checks are safe to repeat: the failed
// sign-in one skips an IP flagged in the last hour, the location one keeps
// a watermark and a dedupe key per account and country.
@Injectable()
export class SecurityHousekeeping implements OnModuleInit {
  constructor(
    private readonly housekeeping: HousekeepingScheduler,
    private readonly suspiciousActivity: SuspiciousActivityService,
  ) {}

  onModuleInit() {
    this.housekeeping.register({
      name: 'security-detection',
      everyMs: FIVE_MINUTES,
      run: async (now) => {
        await this.suspiciousActivity.runDetection(undefined, undefined, now);
      },
    });
  }
}
