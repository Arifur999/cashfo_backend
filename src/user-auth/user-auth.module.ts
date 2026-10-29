import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module.js';
import { EmailVerificationModule } from '../email-verification/email-verification.module.js';
import { MailModule } from '../mail/mail.module.js';
import { OneTimeCodesModule } from '../one-time-codes/one-time-codes.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { UploadsModule } from '../uploads/uploads.module.js';
import { UserAuthController } from './user-auth.controller.js';
import { UserAuthService } from './user-auth.service.js';
import { PhoneController } from './phone.controller.js';
import { PhoneService } from './phone.service.js';
import { SmsModule } from '../sms/sms.module.js';
import { UserProfileService } from './user-profile.service.js';
import { UserProvisioningService } from './user-provisioning.service.js';
import { UserSessionsService } from './user-sessions.service.js';
import { SecurityAlertsService } from './security-alerts.service.js';
import { LoginRateLimitFilter } from './filters/login-rate-limit.filter.js';
import { UserAuthGuard } from './guards/user-auth.guard.js';
import { SystemMessagesModule } from '../system-messages/system-messages.module.js';

@Module({
  // Sessions, tokens and credentials come from the global AuthModule.
  // AccountsModule: UserProvisioningService calls seedDefaultAccounts() for
  // the auto-created default Personal workspace (Prompt 4). Safe --
  // AccountsModule has no dependency back on this module (or on
  // BusinessAccessModule, which itself imports THIS module), so there's no
  // cycle. UploadsModule: ImgbbService, for the avatar-upload route.
  // SettingsModule: SettingsService.get().referralRewardAmount, snapshotted
  // onto a new Referral row when a signup carries someone else's
  // referralCode. Deliberately NOT ReferralsModule itself (that would be
  // circular -- see UserProvisioningService's comment on this). MailModule:
  // MailService, for the welcome and password-reset emails.
  // EmailVerificationModule: the signup's verification email (sent from the
  // first device row). OneTimeCodesModule: the emailed code a password reset
  // asks for when the owner turned that on (Settings > Security > Alerts).
  imports: [AccountsModule, UploadsModule, SettingsModule, MailModule, EmailVerificationModule, OneTimeCodesModule, SmsModule, SystemMessagesModule],
  controllers: [UserAuthController, PhoneController],
  providers: [UserAuthService, PhoneService, UserProfileService, UserSessionsService, UserProvisioningService, SecurityAlertsService, UserAuthGuard, LoginRateLimitFilter],
  // UserAuthService: the unified sign-in (SignInModule) hands end users to it.
  // SecurityAlertsService: a wrong two-step code counts as a failed try.
  exports: [UserAuthGuard, UserAuthService, SecurityAlertsService],
})
export class UserAuthModule {}
