import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { BillingModule } from '../billing/billing.module.js';
import { MailModule } from '../mail/mail.module.js';
import { OneTimeCodesModule } from '../one-time-codes/one-time-codes.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { TransactionsModule } from '../transactions/transactions.module.js';
import { UserAuthModule } from '../user-auth/user-auth.module.js';
import { AdminReferralsController } from './admin-referrals.controller.js';
import { AdminReferralsService } from './admin-referrals.service.js';
import { PayoutMethodsService } from './payout-methods.service.js';
import { ReferralCommissionsService } from './referral-commissions.service.js';
import { ReferralNotices } from './referral-notices.js';
import { ReferralStatements } from './referral-statements.js';
import { SmsModule } from '../sms/sms.module.js';
import { ReferralEarningsService } from './referral-earnings.service.js';
import { ReferralFriendsService } from './referral-friends.service.js';
import { ReferralLinksService } from './referral-links.service.js';
import { ReferralInviteController, ReferralsController } from './referrals.controller.js';
import { ReferralsService } from './referrals.service.js';
import { WithdrawalsService } from './withdrawals.service.js';

// The Referral Program: commissions (made through BillingModule's hooks when
// an invited friend pays), payout methods, withdrawals confirmed with a
// one-time code, and the admin payout desk and settings.
// UserAuthModule: UserAuthGuard. AdminAuthModule: the admin guards.
// TransactionsModule: withLocks() and the income postings. BillingModule:
// BillingHooks and the member's plan. Nothing imports this module back
// (UserAuthModule records a sign-up's referral itself), so there's no cycle.
@Module({
  imports: [UserAuthModule, AdminAuthModule, TransactionsModule, SettingsModule, BillingModule, MailModule, OneTimeCodesModule, SmsModule],
  controllers: [ReferralInviteController, ReferralsController, AdminReferralsController],
  providers: [
    ReferralsService,
    ReferralCommissionsService,
    ReferralNotices,
    ReferralStatements,
    PayoutMethodsService,
    WithdrawalsService,
    AdminReferralsService,
    ReferralFriendsService,
    ReferralEarningsService,
    ReferralLinksService,
  ],
  exports: [ReferralsService],
})
export class ReferralsModule {}
