import { Module } from '@nestjs/common';
import { ReceivablesPayablesModule } from '../receivables-payables/receivables-payables.module.js';
import { MoneyFlowController } from './money-flow.controller.js';
import { MoneyFlowService } from './money-flow.service.js';

// Where a period's money went, for the dashboard; loans come from Loan
// Management.
@Module({
  imports: [ReceivablesPayablesModule],
  controllers: [MoneyFlowController],
  providers: [MoneyFlowService],
})
export class MoneyFlowModule {}
