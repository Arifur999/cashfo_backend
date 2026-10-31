import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module.js';
import { TransactionsModule } from '../transactions/transactions.module.js';
import { SavingsGoalsController } from './savings-goals.controller.js';
import { SavingsGoalsService } from './savings-goals.service.js';
import { SavingsRemindersService } from './savings-reminders.service.js';

// TransactionsModule posts the real double-entry Transaction behind each
// contribution and withdrawal; MailModule names the platform on a
// statement PDF and sends the reminder emails.
@Module({
  imports: [TransactionsModule, MailModule],
  controllers: [SavingsGoalsController],
  providers: [SavingsGoalsService, SavingsRemindersService],
  exports: [SavingsGoalsService],
})
export class SavingsGoalsModule {}
