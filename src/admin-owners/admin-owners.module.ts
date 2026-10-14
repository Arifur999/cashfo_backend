import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module.js';
import { AdminOwnersController } from './admin-owners.controller.js';
import { AdminOwnersService } from './admin-owners.service.js';
import { OwnerImpersonationService } from './owner-impersonation.service.js';

@Module({
  imports: [AccountsModule],
  controllers: [AdminOwnersController],
  providers: [AdminOwnersService, OwnerImpersonationService],
})
export class AdminOwnersModule {}
