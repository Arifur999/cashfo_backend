import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { TransactionsModule } from '../transactions/transactions.module.js';
import { UserAuthModule } from '../user-auth/user-auth.module.js';
import { ReferralsController, ReferralsWithdrawController } from './referrals.controller.js';
import { ReferralsService } from './referrals.service.js';

// UserAuthModule: for UserAuthGuard on ReferralsController.
// TransactionsModule: for TransactionsService.createTransaction() (withdraw()'s
// real Income transaction).
// SettingsModule: for SettingsService.get().referralRewardAmount.
// Deliberately NOT the other way around -- UserAuthModule never imports
// this module back (see UserAuthService's own comment on why it can't
// inject ReferralsService), so there's no cycle.
@Module({
  imports: [UserAuthModule, TransactionsModule, SettingsModule],
  controllers: [ReferralsController, ReferralsWithdrawController],
  providers: [ReferralsService],
  exports: [ReferralsService],
})
export class ReferralsModule {}
