import { Module } from '@nestjs/common';
import { AccountExportModule } from '../account-export/account-export.module.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { BillingModule } from '../billing/billing.module.js';
import { SupportAccessModule } from '../support-access/support-access.module.js';
import { AdminNotesService } from './admin-notes.service.js';
import { AdminOwnersController } from './admin-owners.controller.js';
import { AdminOwnersService } from './admin-owners.service.js';
import { OwnerImpersonationService } from './owner-impersonation.service.js';

@Module({
  // BillingModule: Change plan goes through SubscriptionsService.applyPlan().
  // AccountExportModule: "Download a copy" before a reset.
  imports: [AccountsModule, SupportAccessModule, BillingModule, AccountExportModule],
  controllers: [AdminOwnersController],
  providers: [AdminOwnersService, OwnerImpersonationService, AdminNotesService],
})
export class AdminOwnersModule {}
