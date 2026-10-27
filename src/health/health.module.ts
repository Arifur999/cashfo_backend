import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { BillingModule } from '../billing/billing.module.js';
import { MailModule } from '../mail/mail.module.js';
import { AdminSystemHealthController } from './admin-system-health.controller.js';
import { ApiHealthController } from './api-health.controller.js';
import { HealthController } from './health.controller.js';
import { SystemHealthService } from './system-health.service.js';

// BillingModule: PaymentGateways, for whether a real gateway is set up.
@Module({
  imports: [BillingModule, MailModule, AdminAuthModule],
  controllers: [HealthController, ApiHealthController, AdminSystemHealthController],
  providers: [SystemHealthService],
  exports: [SystemHealthService],
})
export class HealthModule {}
