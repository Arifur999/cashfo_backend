import { Module } from '@nestjs/common';
import { BudgetsModule } from '../budgets/budgets.module.js';
import { PushModule } from '../push/push.module.js';
import { ReceivablesPayablesModule } from '../receivables-payables/receivables-payables.module.js';
import { ReportsModule } from '../reports/reports.module.js';
import { SavingsGoalsModule } from '../savings-goals/savings-goals.module.js';
import { InsightsController, InsightsSettingsController } from './insights.controller.js';
import { InsightsService } from './insights.service.js';

// AI Insights: rules over a workspace's spending (Reports, Budgets), its
// savings goals and who owes it (Loan Management).
@Module({
  imports: [ReportsModule, BudgetsModule, SavingsGoalsModule, ReceivablesPayablesModule, PushModule],
  controllers: [InsightsController, InsightsSettingsController],
  providers: [InsightsService],
})
export class InsightsModule {}
