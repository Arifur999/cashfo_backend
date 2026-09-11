import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

// No imports needed -- ReportsService only reads Account.currentBalance
// (already kept correct by the Transaction Engine) via PrismaService
// (global), and its own controller's guard comes from the @Global()
// BusinessAccessModule. isDebitPositive is a plain exported function import
// from accounts/account-balance.service.ts, not a DI dependency, so it
// doesn't require importing AccountsModule either.
@Module({
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
