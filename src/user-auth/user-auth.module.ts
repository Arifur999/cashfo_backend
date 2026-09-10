import { Module } from '@nestjs/common';
import { UserAuthController } from './user-auth.controller.js';
import { UserAuthService } from './user-auth.service.js';
import { UserAuthGuard } from './guards/user-auth.guard.js';

// JwtModule registration and real provider wiring (TokenBlacklistService,
// LoginRateLimitFilter, etc., mirroring admin-auth) land in Prompt 2 once
// there's real sign()/verify() logic to support.
@Module({
  controllers: [UserAuthController],
  providers: [UserAuthService, UserAuthGuard],
  exports: [UserAuthGuard],
})
export class UserAuthModule {}
