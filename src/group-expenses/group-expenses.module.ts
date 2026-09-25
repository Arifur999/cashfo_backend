import { Module } from '@nestjs/common';
import { GroupExpensesController } from './group-expenses.controller.js';
import { GroupExpensesService } from './group-expenses.service.js';

// Self-contained -- unlike SavingsGoalsModule/QuickEntriesModule, this does
// NOT import TransactionsModule: Group Expense deliberately never touches
// the Account/Transaction double-entry engine (see the schema comment above
// the GroupMember model for why).
@Module({
  controllers: [GroupExpensesController],
  providers: [GroupExpensesService],
})
export class GroupExpensesModule {}
