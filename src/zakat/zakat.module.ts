import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { ReceivablesPayablesModule } from '../receivables-payables/receivables-payables.module.js';
import { TransactionsModule } from '../transactions/transactions.module.js';
import { AdminZakatPricesController, ZakatController } from './zakat.controller.js';
import { ZakatPricesService } from './zakat-prices.service.js';
import { ZakatService } from './zakat.service.js';

// Zakat calculator: reads wallets, assets and contacts' balances
// (ReceivablesPayablesModule), posts zakat given as an expense
// (TransactionsModule), and the admin's BAJUS prices (AdminAuthModule for
// its guards).
@Module({
  imports: [TransactionsModule, ReceivablesPayablesModule, AdminAuthModule],
  controllers: [ZakatController, AdminZakatPricesController],
  providers: [ZakatService, ZakatPricesService],
  exports: [ZakatPricesService],
})
export class ZakatModule {}
