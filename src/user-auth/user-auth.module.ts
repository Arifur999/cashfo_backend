import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module.js';
import { MailModule } from '../mail/mail.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { UploadsModule } from '../uploads/uploads.module.js';
import { UserAuthController } from './user-auth.controller.js';
import { UserAuthService } from './user-auth.service.js';
import { UserProfileService } from './user-profile.service.js';
import { UserProvisioningService } from './user-provisioning.service.js';
import { UserSessionsService } from './user-sessions.service.js';
import { LoginRateLimitFilter } from './filters/login-rate-limit.filter.js';
import { UserAuthGuard } from './guards/user-auth.guard.js';

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
  imports: [AccountsModule, UploadsModule, SettingsModule, MailModule],
  controllers: [UserAuthController],
  providers: [UserAuthService, UserProfileService, UserSessionsService, UserProvisioningService, UserAuthGuard, LoginRateLimitFilter],
  exports: [UserAuthGuard],
})
export class UserAuthModule {}
