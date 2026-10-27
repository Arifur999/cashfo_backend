import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { BillingModule } from '../billing/billing.module.js';
import { DevPaymentsController } from './dev-payments.controller.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';

@Module({
  // BillingModule: Mark paid / failed, retry and refunds reach the
  // customer's plan through it.
  imports: [AdminAuthModule, BillingModule],
  controllers: [
    PaymentsController,
    // Genuinely absent from the router in production, not just guarded --
    // see dev-payments.controller.ts.
    ...(process.env.NODE_ENV !== 'production' ? [DevPaymentsController] : []),
  ],
  providers: [PaymentsService],
})
export class PaymentsModule {}
