import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { PlatformUsersController } from './platform-users.controller.js';
import { PlatformUsersService } from './platform-users.service.js';

@Module({
  // AdminAuthModule exports AdminAuthGuard/RolesGuard (used via @UseGuards())
  // and JwtModule (used directly by PlatformUsersService for impersonation
  // tokens).
  imports: [AdminAuthModule],
  controllers: [PlatformUsersController],
  providers: [PlatformUsersService],
})
export class PlatformUsersModule {}
