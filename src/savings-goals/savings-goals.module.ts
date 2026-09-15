import { Module } from '@nestjs/common';
import { TransactionsModule } from '../transactions/transactions.module.js';
import { SavingsGoalsController } from './savings-goals.controller.js';
import { SavingsGoalsService } from './savings-goals.service.js';

// Only needs TransactionsModule (for TransactionsService, to post the real
// double-entry Transaction behind each contribution) -- same shape as
// QuickEntriesModule.
@Module({
  imports: [TransactionsModule],
  controllers: [SavingsGoalsController],
  providers: [SavingsGoalsService],
})
export class SavingsGoalsModule {}
