import { Module, type OnModuleInit } from '@nestjs/common';
import { HousekeepingScheduler } from '../housekeeping/housekeeping.scheduler.js';
import { MailModule } from '../mail/mail.module.js';
import { MonthlySummaryService } from './monthly-summary.service.js';

const HOUR = 60 * 60 * 1000;

// The monthly summary email. There is no read path to run it lazily on;
// each run only sends what is due and not yet claimed, so a missed or
// doubled run is harmless.
@Module({
  imports: [MailModule],
  providers: [MonthlySummaryService],
})
export class MonthlySummaryModule implements OnModuleInit {
  constructor(
    private readonly housekeeping: HousekeepingScheduler,
    private readonly summaries: MonthlySummaryService,
  ) {}

  onModuleInit() {
    this.housekeeping.register({
      name: 'monthly-summary-email',
      everyMs: HOUR,
      run: async (now) => {
        await this.summaries.run(now);
      },
    });
  }
}
