import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { RevenueController } from './revenue.controller.js';
import { RevenueService } from './revenue.service.js';

@Module({
  imports: [AdminAuthModule],
  controllers: [RevenueController],
  providers: [RevenueService],
})
export class RevenueModule {}
