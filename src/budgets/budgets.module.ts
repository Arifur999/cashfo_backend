import { Module } from '@nestjs/common';
import { BudgetsController } from './budgets.controller.js';
import { BudgetsService } from './budgets.service.js';

// @RequireBusinessMembership()/@RequireRole() come from the @Global()
// BusinessAccessModule, same as every other workspace-scoped module -- no
// explicit import needed here.
@Module({
  controllers: [BudgetsController],
  providers: [BudgetsService],
})
export class BudgetsModule {}
