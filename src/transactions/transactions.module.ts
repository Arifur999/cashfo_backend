import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module.js';
import { TransactionsController } from './transactions.controller.js';
import { TransactionsService } from './transactions.service.js';

// Imports AccountsModule for AccountBalanceService (recalculateBalance()
// after every create/void). One-directional -- AccountsModule has no
// dependency back on this module, so no cycle. Its own controller's guards
// come from the @Global() BusinessAccessModule, same as AccountsModule's.
@Module({
  imports: [AccountsModule],
  controllers: [TransactionsController],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
