import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { UserAuthModule } from '../user-auth/user-auth.module.js';
import { SignInController } from './sign-in.controller.js';
import { SignInService } from './sign-in.service.js';

// The site-wide sign-in (POST /api/auth/sign-in and /session/sign-in). It
// owns no auth logic of its own -- it picks the side by role and delegates.
@Module({
  imports: [AdminAuthModule, UserAuthModule],
  controllers: [SignInController],
  providers: [SignInService],
})
export class SignInModule {}
