import { Module } from '@nestjs/common';
import { GroupAccessModule } from '../group-access/group-access.module.js';
import { GroupEditorRules } from './group-editor-rules.js';
import { GroupExpensesController } from './group-expenses.controller.js';
import { GroupExpensesService } from './group-expenses.service.js';
import { GroupSummaryController } from './group-summary.controller.js';
import { GroupSummaryService } from './group-summary.service.js';
import { UploadsModule } from '../uploads/uploads.module.js';

// Self-contained otherwise -- unlike SavingsGoalsModule/QuickEntriesModule,
// this does NOT import TransactionsModule: Group Expense deliberately never
// touches the Account/Transaction double-entry engine (see the schema
// comment above the GroupMember model for why). UploadsModule: ImgbbService,
// for the member-photo-upload route. GroupSummaryController: the group
// list's month figures, across every group the customer belongs to.
@Module({
  imports: [UploadsModule, GroupAccessModule],
  controllers: [GroupSummaryController, GroupExpensesController],
  providers: [GroupExpensesService, GroupSummaryService, GroupEditorRules],
})
export class GroupExpensesModule {}
