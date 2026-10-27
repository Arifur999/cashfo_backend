import { Injectable, type OnModuleInit } from '@nestjs/common';
import { HousekeepingScheduler } from '../housekeeping/housekeeping.scheduler.js';
import { NotificationCampaignsService } from './notification-campaigns.service.js';

const FIVE_MINUTES = 5 * 60 * 1000;

// Scheduled campaigns go out on the timer; reading the campaigns list
// starts any that are due as well (NotificationCampaignsService.list).
@Injectable()
export class NotificationCampaignsHousekeeping implements OnModuleInit {
  constructor(
    private readonly housekeeping: HousekeepingScheduler,
    private readonly campaigns: NotificationCampaignsService,
  ) {}

  onModuleInit() {
    this.housekeeping.register({ name: 'campaign-scheduled-send', everyMs: FIVE_MINUTES, run: (now) => this.campaigns.sendDue(now) });
  }
}
