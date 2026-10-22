import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { PlatformUsersController } from './platform-users.controller.js';
import { PlatformUsersService } from './platform-users.service.js';

@Module({
  // AdminAuthModule exports AdminAuthGuard/RolesGuard (used via @UseGuards()).
  // There is no impersonation here: "View as customer" lives in
  // AdminOwnersModule and needs the customer's support code.
  imports: [AdminAuthModule],
  controllers: [PlatformUsersController],
  providers: [PlatformUsersService],
})
export class PlatformUsersModule {}
