import { Module } from '@nestjs/common';
import { TransactionsModule } from '../transactions/transactions.module.js';
import { BalanceAdjustmentsController } from './balance-adjustments.controller.js';
import { BalanceAdjustmentsService } from './balance-adjustments.service.js';

// Match real balance (Balance > Accounts): posts through TransactionsModule,
// which itself imports AccountsModule, so it can't live there.
@Module({
  imports: [TransactionsModule],
  controllers: [BalanceAdjustmentsController],
  providers: [BalanceAdjustmentsService],
})
export class BalanceAdjustmentsModule {}
