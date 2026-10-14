import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { UserAuthModule } from '../user-auth/user-auth.module.js';
import { BusinessMembershipGuard } from './guards/business-membership.guard.js';
import { BusinessRoleGuard } from './guards/business-role.guard.js';
import { WorkspaceUnlockService } from './workspace-unlock.service.js';

// @Global(): every guard/decorator this module provides needs to be usable
// from any future resource module (accounts, and everything Prompt 5+
// adds) without that module explicitly importing this one -- see the long
// comment on RequireBusinessMembership() for why that specifically matters
// here (it breaks a would-be circular import between UserAuthModule,
// BusinessesModule, and AccountsModule). Registered once in AppModule.
// JwtModule: WorkspaceUnlockService signs and checks PIN unlocks.
@Global()
@Module({
  imports: [UserAuthModule, JwtModule.register({})],
  providers: [BusinessMembershipGuard, BusinessRoleGuard, WorkspaceUnlockService],
  exports: [UserAuthModule, BusinessMembershipGuard, BusinessRoleGuard, WorkspaceUnlockService],
})
export class BusinessAccessModule {}
