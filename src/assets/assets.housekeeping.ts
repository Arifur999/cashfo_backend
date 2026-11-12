import { Injectable, type OnModuleInit } from '@nestjs/common';
import { HousekeepingScheduler } from '../housekeeping/housekeeping.scheduler.js';
import { AssetsService } from './assets.service.js';

const FIVE_MINUTES = 5 * 60 * 1000;

// Deleted assets kept for their Undo: once the undo window has passed, the
// delete is final and the kept copy goes.
@Injectable()
export class AssetsHousekeeping implements OnModuleInit {
  constructor(
    private readonly housekeeping: HousekeepingScheduler,
    private readonly assets: AssetsService,
  ) {}

  onModuleInit() {
    this.housekeeping.register({ name: 'asset-deletion-purge', everyMs: FIVE_MINUTES, run: async (now) => void (await this.assets.purgeDeletions(now)) });
  }
}
