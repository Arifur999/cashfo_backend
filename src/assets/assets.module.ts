import { Module } from '@nestjs/common';
import { TransactionsModule } from '../transactions/transactions.module.js';
import { AssetsController } from './assets.controller.js';
import { AssetsService } from './assets.service.js';

@Module({
  imports: [TransactionsModule],
  controllers: [AssetsController],
  providers: [AssetsService],
})
export class AssetsModule {}
