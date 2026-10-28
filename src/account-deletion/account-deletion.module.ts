import { Global, Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module.js';
import { UserAuthModule } from '../user-auth/user-auth.module.js';
import { AccountDeletionController } from './account-deletion.controller.js';
import { AccountDeletionHousekeeping } from './account-deletion.housekeeping.js';
import { AccountDeletionService } from './account-deletion.service.js';

// Delete my account, with a 30-day grace. Global, like TwoStepModule: the
// sign-in (UserAuthModule) restores a pending account through it, and its
// controller uses UserAuthModule's guard -- importing each other would be
// circular.
@Global()
@Module({
  imports: [UserAuthModule, MailModule],
  controllers: [AccountDeletionController],
  providers: [AccountDeletionService, AccountDeletionHousekeeping],
  exports: [AccountDeletionService],
})
export class AccountDeletionModule {}
