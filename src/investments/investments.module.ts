import { Module } from '@nestjs/common';
import { TransactionsModule } from '../transactions/transactions.module.js';
import { InvestmentsController } from './investments.controller.js';
import { InvestmentsHousekeeping } from './investments.housekeeping.js';
import { InvestmentsService } from './investments.service.js';

@Module({
  imports: [TransactionsModule],
  controllers: [InvestmentsController],
  providers: [InvestmentsService, InvestmentsHousekeeping],
})
export class InvestmentsModule {}
