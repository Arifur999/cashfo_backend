import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module.js';
import { TransactionsModule } from '../transactions/transactions.module.js';
import { SavingsGoalsController } from './savings-goals.controller.js';
import { SavingsGoalsService } from './savings-goals.service.js';
import { SavingsRemindersService } from './savings-reminders.service.js';
import { SavingsPlansController } from '../savings-plans/savings-plans.controller.js';
import { SavingsPlansService } from '../savings-plans/savings-plans.service.js';

// TransactionsModule posts the real double-entry Transaction behind each
// contribution and withdrawal; MailModule names the platform on a
// statement PDF and sends the reminder emails. Saving plans live here too:
// a plan becomes a goal, and a goal goes back to being a plan.
@Module({
  imports: [TransactionsModule, MailModule],
  controllers: [SavingsGoalsController, SavingsPlansController],
  providers: [SavingsGoalsService, SavingsRemindersService, SavingsPlansService],
  exports: [SavingsGoalsService],
})
export class SavingsGoalsModule {}
