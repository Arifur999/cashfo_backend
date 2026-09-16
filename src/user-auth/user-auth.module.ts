import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AccountsModule } from '../accounts/accounts.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { UploadsModule } from '../uploads/uploads.module.js';
import { UserAuthController } from './user-auth.controller.js';
import { UserAuthService } from './user-auth.service.js';
import { LoginRateLimitFilter } from './filters/login-rate-limit.filter.js';
import { UserAuthGuard } from './guards/user-auth.guard.js';
import { TokenBlacklistService } from './token-blacklist.service.js';

@Module({
  // Registered without a default secret/expiry -- access and refresh tokens
  // use different secrets and lifetimes, passed explicitly on every
  // sign()/verify() call in UserAuthService and UserAuthGuard.
  // AccountsModule: register() calls AccountsService.seedDefaultAccounts()
  // for the auto-created default Personal workspace (Prompt 4). Safe --
  // AccountsModule has no dependency back on this module (or on
  // BusinessAccessModule, which itself imports THIS module), so there's no
  // cycle. UploadsModule: ImgbbService, for the avatar-upload route.
  // SettingsModule: SettingsService.get().referralRewardAmount, snapshotted
  // onto a new Referral row when register() is passed someone else's
  // referralCode. Deliberately NOT ReferralsModule itself (that would be
  // circular -- see UserAuthService's own comment on this).
  imports: [JwtModule.register({}), AccountsModule, UploadsModule, SettingsModule],
  controllers: [UserAuthController],
  providers: [UserAuthService, UserAuthGuard, TokenBlacklistService, LoginRateLimitFilter],
  exports: [JwtModule, UserAuthGuard],
})
export class UserAuthModule {}
