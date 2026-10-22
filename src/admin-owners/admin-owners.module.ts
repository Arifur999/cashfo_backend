import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module.js';
import { SupportAccessModule } from '../support-access/support-access.module.js';
import { AdminOwnersController } from './admin-owners.controller.js';
import { AdminOwnersService } from './admin-owners.service.js';
import { OwnerImpersonationService } from './owner-impersonation.service.js';

@Module({
  imports: [AccountsModule, SupportAccessModule],
  controllers: [AdminOwnersController],
  providers: [AdminOwnersService, OwnerImpersonationService],
})
export class AdminOwnersModule {}
