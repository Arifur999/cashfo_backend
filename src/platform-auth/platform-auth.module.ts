import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PlatformAuthController } from './platform-auth.controller.js';
import { PlatformAuthService } from './platform-auth.service.js';
import { LoginRateLimitFilter } from './filters/login-rate-limit.filter.js';
import { PlatformAuthGuard } from './guards/platform-auth.guard.js';
import { TokenBlacklistService } from './token-blacklist.service.js';

@Module({
  // Registered without a default secret/expiry -- access and refresh tokens
  // use different secrets and lifetimes, passed explicitly on every
  // sign()/verify() call in PlatformAuthService and PlatformAuthGuard.
  imports: [JwtModule.register({})],
  controllers: [PlatformAuthController],
  providers: [PlatformAuthService, PlatformAuthGuard, TokenBlacklistService, LoginRateLimitFilter],
  exports: [JwtModule, PlatformAuthGuard],
})
export class PlatformAuthModule {}
