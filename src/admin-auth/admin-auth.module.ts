import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AdminAuthController } from './admin-auth.controller.js';
import { AdminAuthService } from './admin-auth.service.js';
import { LoginRateLimitFilter } from './filters/login-rate-limit.filter.js';
import { AdminAuthGuard } from './guards/admin-auth.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import { TokenBlacklistService } from './token-blacklist.service.js';

@Module({
  // Registered without a default secret/expiry -- access and refresh tokens
  // use different secrets and lifetimes, passed explicitly on every
  // sign()/verify() call in AdminAuthService and AdminAuthGuard.
  imports: [JwtModule.register({})],
  controllers: [AdminAuthController],
  providers: [AdminAuthService, AdminAuthGuard, RolesGuard, TokenBlacklistService, LoginRateLimitFilter],
  // Export JwtModule too -- AdminAuthGuard depends on JwtService, so any
  // module that imports AdminAuthModule to use the guard needs JwtService
  // resolvable in its own injector context as well.
  exports: [JwtModule, AdminAuthGuard, RolesGuard],
})
export class AdminAuthModule {}
