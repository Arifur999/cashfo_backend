import { Module, type OnModuleInit } from '@nestjs/common';
import { HousekeepingScheduler } from '../housekeeping/housekeeping.scheduler.js';
import { MailModule } from '../mail/mail.module.js';
import { ReceivablesPayablesModule } from '../receivables-payables/receivables-payables.module.js';
import { MonthlySummaryService } from './monthly-summary.service.js';
import { PeriodSummaryService } from './period-summary.service.js';

const HOUR = 60 * 60 * 1000;
const FIVE_MINUTES = 5 * 60 * 1000;

// The monthly summary email. There is no read path to run it lazily on;
// each run only sends what is due and not yet claimed, so a missed or
// doubled run is harmless.
@Module({
  imports: [MailModule, ReceivablesPayablesModule],
  providers: [MonthlySummaryService, PeriodSummaryService],
})
export class MonthlySummaryModule implements OnModuleInit {
  constructor(
    private readonly housekeeping: HousekeepingScheduler,
    private readonly summaries: MonthlySummaryService,
    private readonly periodSummaries: PeriodSummaryService,
  ) {}

  onModuleInit() {
    this.housekeeping.register({
      name: 'monthly-summary-email',
      everyMs: HOUR,
      run: async (now) => {
        await this.summaries.run(now);
      },
    });
    // Settings › Notifications' daily or weekly summary, from its chosen time.
    this.housekeeping.register({
      name: 'period-summary-email',
      everyMs: FIVE_MINUTES,
      run: async (now) => {
        await this.periodSummaries.run(now);
      },
    });
  }
}
