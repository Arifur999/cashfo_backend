import { Module } from '@nestjs/common';
import { ContactsController } from './contacts.controller.js';
import { ContactsService } from './contacts.service.js';
import { TransactionsModule } from '../transactions/transactions.module.js';

// Imports TransactionsModule for TransactionsService.listTransactions()
// (the :id/transactions activity endpoint reuses it with a contactId
// filter rather than duplicating pagination/filtering logic here).
// One-directional -- TransactionsModule has no dependency back on this
// module, so no cycle. @RequireBusinessMembership()/@RequireRole() come
// from the @Global() BusinessAccessModule, same as every other module.
@Module({
  imports: [TransactionsModule],
  controllers: [ContactsController],
  providers: [ContactsService],
  exports: [ContactsService],
})
export class ContactsModule {}
