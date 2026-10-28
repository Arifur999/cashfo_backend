import { Injectable, type OnModuleInit } from '@nestjs/common';
import { HousekeepingScheduler } from '../housekeeping/housekeeping.scheduler.js';
import { AccountDeletionService } from './account-deletion.service.js';

const FIFTEEN_MINUTES = 15 * 60 * 1000;

// The account purge on the housekeeping timer: accounts whose 30 days are
// up. A sign-in that finds one due purges it on the spot too
// (AccountDeletionService.restoreOnSignIn), so the timer only catches up.
@Injectable()
export class AccountDeletionHousekeeping implements OnModuleInit {
  constructor(
    private readonly housekeeping: HousekeepingScheduler,
    private readonly deletion: AccountDeletionService,
  ) {}

  onModuleInit() {
    this.housekeeping.register({ name: 'account-purge', everyMs: FIFTEEN_MINUTES, run: async (now) => void (await this.deletion.purgeDue(now)) });
  }
}
