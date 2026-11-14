import { Injectable, type OnModuleInit } from '@nestjs/common';
import { HousekeepingScheduler } from '../housekeeping/housekeeping.scheduler.js';
import { InvestmentsService } from './investments.service.js';

const FIVE_MINUTES = 5 * 60 * 1000;

// Deleted investments and entries kept for their Undo: once the undo window
// has passed, the delete is final and the kept copy goes.
@Injectable()
export class InvestmentsHousekeeping implements OnModuleInit {
  constructor(
    private readonly housekeeping: HousekeepingScheduler,
    private readonly investments: InvestmentsService,
  ) {}

  onModuleInit() {
    this.housekeeping.register({
      name: 'investment-deletion-purge',
      everyMs: FIVE_MINUTES,
      run: async (now) => void (await this.investments.purgeDeletions(now)),
    });
  }
}
