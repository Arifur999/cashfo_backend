import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AdminAuthController } from './admin-auth.controller.js';
import { AdminAuthService } from './admin-auth.service.js';
import { LoginRateLimitFilter } from './filters/login-rate-limit.filter.js';
import { AdminAuthGuard } from './guards/admin-auth.guard.js';
import { RolesGuard } from './guards/roles.guard.js';

@Module({
  // Tokens and sessions come from the global AuthModule. JwtModule stays
  // only for modules that import this one and sign tokens of their own
  // (PlatformUsersService's impersonation).
  imports: [JwtModule.register({})],
  controllers: [AdminAuthController],
  providers: [AdminAuthService, AdminAuthGuard, RolesGuard, LoginRateLimitFilter],
  exports: [JwtModule, AdminAuthGuard, RolesGuard],
})
export class AdminAuthModule {}
