import { Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module.js';
import { HousekeepingScheduler } from '../housekeeping/housekeeping.scheduler.js';
import { BackupsController } from './backups.controller.js';
import { BackupsService } from './backups.service.js';

const FIVE_MINUTES = 5 * 60 * 1000;

// Automatic backups on the housekeeping timer (from 2:00 at night).
@Injectable()
class BackupsHousekeeping implements OnModuleInit {
  constructor(
    private readonly housekeeping: HousekeepingScheduler,
    private readonly backups: BackupsService,
  ) {}

  onModuleInit() {
    this.housekeeping.register({ name: 'automatic-backups', everyMs: FIVE_MINUTES, run: async (now) => void (await this.backups.runAuto(now)) });
  }
}

@Module({
  imports: [AccountsModule],
  controllers: [BackupsController],
  providers: [BackupsService, BackupsHousekeeping],
  exports: [BackupsService],
})
export class BackupsModule {}
