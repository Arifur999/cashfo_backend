import { Module } from '@nestjs/common';
import { ContactsController } from './contacts.controller.js';
import { ContactsService } from './contacts.service.js';
import { ReceivablesPayablesModule } from '../receivables-payables/receivables-payables.module.js';
import { TransactionsModule } from '../transactions/transactions.module.js';

// Imports TransactionsModule for TransactionsService.listTransactions()
// (the :id/transactions activity endpoint reuses it with a contactId
// filter rather than duplicating pagination/filtering logic here) and
// ReceivablesPayablesModule for Contact.currentBalance (Prompt 9). Both
// one-directional -- neither has a dependency back on this module, so no
// cycle. @RequireBusinessMembership()/@RequireRole() come from the
// @Global() BusinessAccessModule, same as every other module.
@Module({
  imports: [TransactionsModule, ReceivablesPayablesModule],
  controllers: [ContactsController],
  providers: [ContactsService],
  exports: [ContactsService],
})
export class ContactsModule {}
