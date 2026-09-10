import { Module } from '@nestjs/common';
import { AccountBalanceService } from './account-balance.service.js';
import { AccountsController } from './accounts.controller.js';
import { AccountsService } from './accounts.service.js';

// No imports needed for its own controller's guards -- @RequireBusinessMembership()
// comes from the @Global() BusinessAccessModule (registered once in
// AppModule), not an explicit import here. This is what keeps this module
// free to be imported BY UserAuthModule and BusinessesModule (for
// seedDefaultAccounts()) without creating a cycle back to either of them.
// AccountBalanceService is exported so TransactionsModule (Prompt 5) can
// call recalculateBalance() after every create/void -- that's a one-way
// import (TransactionsModule -> AccountsModule), no cycle.
@Module({
  controllers: [AccountsController],
  providers: [AccountsService, AccountBalanceService],
  exports: [AccountsService, AccountBalanceService],
})
export class AccountsModule {}
