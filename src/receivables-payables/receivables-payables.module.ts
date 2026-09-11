import { Module } from '@nestjs/common';
import { ReceivablesPayablesController } from './receivables-payables.controller.js';
import { ReceivablesPayablesService } from './receivables-payables.service.js';
import { TransactionsModule } from '../transactions/transactions.module.js';

// Imports TransactionsModule for TransactionsService.createTransaction()
// (every write here is a thin wrapper around it, same pattern as
// QuickEntriesModule). Exports ReceivablesPayablesService so ContactsModule
// can use getContactCurrentBalance() for Contact.currentBalance -- one-
// directional (ContactsModule -> this module), no cycle. Its own
// controller's guards come from the @Global() BusinessAccessModule.
@Module({
  imports: [TransactionsModule],
  controllers: [ReceivablesPayablesController],
  providers: [ReceivablesPayablesService],
  exports: [ReceivablesPayablesService],
})
export class ReceivablesPayablesModule {}
