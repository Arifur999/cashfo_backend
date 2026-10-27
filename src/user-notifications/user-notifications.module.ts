import { Module } from '@nestjs/common';
import { AnnouncementsModule } from '../announcements/announcements.module.js';
import { BudgetsModule } from '../budgets/budgets.module.js';
import { MailModule } from '../mail/mail.module.js';
import { ReceivablesPayablesModule } from '../receivables-payables/receivables-payables.module.js';
import { SavingsGoalsModule } from '../savings-goals/savings-goals.module.js';
import { UserNotificationsController } from './user-notifications.controller.js';
import { UserNotificationsService } from './user-notifications.service.js';

// The customer's bell. Reads each feature's own figures through its service
// (budgets, loans, savings, announcements), so a reminder says exactly what
// that page shows.
@Module({
  // MailModule: whether email is set up, for the monthly summary switch.
  imports: [AnnouncementsModule, BudgetsModule, ReceivablesPayablesModule, SavingsGoalsModule, MailModule],
  controllers: [UserNotificationsController],
  providers: [UserNotificationsService],
})
export class UserNotificationsModule {}
