import { Module } from '@nestjs/common';
import { TransactionsModule } from '../transactions/transactions.module.js';
import { ImportsController } from './imports.controller.js';
import { ImportsService } from './imports.service.js';

@Module({
  imports: [TransactionsModule],
  controllers: [ImportsController],
  providers: [ImportsService],
})
export class ImportsModule {}
