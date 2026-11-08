import { Module } from '@nestjs/common';
import { ReceivablesPayablesModule } from '../receivables-payables/receivables-payables.module.js';
import { SavingsGoalsModule } from '../savings-goals/savings-goals.module.js';
import { MoneyFlowController, PeriodReportController } from './money-flow.controller.js';
import { MoneyFlowService } from './money-flow.service.js';
import { NetWorthService } from './net-worth.service.js';
import { PeriodReportService } from './period-report.service.js';

// Where a period's money went, for the dashboard; loans come from Loan
// Management.
@Module({
  imports: [ReceivablesPayablesModule, SavingsGoalsModule],
  controllers: [MoneyFlowController, PeriodReportController],
  providers: [MoneyFlowService, PeriodReportService, NetWorthService],
})
export class MoneyFlowModule {}
