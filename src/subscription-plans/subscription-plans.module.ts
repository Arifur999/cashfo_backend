import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { SubscriptionPlansController } from './subscription-plans.controller.js';
import { SubscriptionPlansService } from './subscription-plans.service.js';

@Module({
  imports: [AdminAuthModule],
  controllers: [SubscriptionPlansController],
  providers: [SubscriptionPlansService],
})
export class SubscriptionPlansModule {}
