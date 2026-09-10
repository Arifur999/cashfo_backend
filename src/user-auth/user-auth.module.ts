import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { UserAuthController } from './user-auth.controller.js';
import { UserAuthService } from './user-auth.service.js';
import { LoginRateLimitFilter } from './filters/login-rate-limit.filter.js';
import { UserAuthGuard } from './guards/user-auth.guard.js';
import { TokenBlacklistService } from './token-blacklist.service.js';

@Module({
  // Registered without a default secret/expiry -- access and refresh tokens
  // use different secrets and lifetimes, passed explicitly on every
  // sign()/verify() call in UserAuthService and UserAuthGuard.
  imports: [JwtModule.register({})],
  controllers: [UserAuthController],
  providers: [UserAuthService, UserAuthGuard, TokenBlacklistService, LoginRateLimitFilter],
  exports: [JwtModule, UserAuthGuard],
})
export class UserAuthModule {}
