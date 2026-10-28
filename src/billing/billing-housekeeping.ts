import { Injectable, type OnModuleInit } from '@nestjs/common';
import { HousekeepingScheduler } from '../housekeeping/housekeeping.scheduler.js';
import { SubscriptionsService } from './subscriptions.service.js';

const FIVE_MINUTES = 5 * 60 * 1000;

// Billing's timer jobs. Both also run lazily for one customer whenever
// their billing page is read (SubscriptionsService.sweepUser).
@Injectable()
export class BillingHousekeeping implements OnModuleInit {
  constructor(
    private readonly housekeeping: HousekeepingScheduler,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  onModuleInit() {
    this.housekeeping.register({ name: 'billing-pending-expiry', everyMs: FIVE_MINUTES, run: (now) => this.subscriptions.expirePendingPayments(now) });
    this.housekeeping.register({ name: 'billing-plan-expiry', everyMs: FIVE_MINUTES, run: (now) => this.subscriptions.sweepAll(now) });
  }
}
