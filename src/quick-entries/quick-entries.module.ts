import { Module } from '@nestjs/common';
import { TransactionsModule } from '../transactions/transactions.module.js';
import { QuickEntriesController } from './quick-entries.controller.js';
import { QuickEntriesService } from './quick-entries.service.js';

// Only needs TransactionsModule (for TransactionsService) -- account
// lookups/validation happen via PrismaService directly (MONEY_ACCOUNT_SUBTYPES
// is just an imported constant, not a service call, so no AccountsModule
// import is needed here). One-directional: TransactionsModule/AccountsModule
// have no dependency back on this module, so no cycle. Its own controller's
// guards come from the @Global() BusinessAccessModule, same as every other
// resource module.
@Module({
  imports: [TransactionsModule],
  controllers: [QuickEntriesController],
  providers: [QuickEntriesService],
})
export class QuickEntriesModule {}
