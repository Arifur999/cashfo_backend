import { Global, Module } from '@nestjs/common';
import { UserAuthModule } from '../user-auth/user-auth.module.js';
import { BusinessMembershipGuard } from './guards/business-membership.guard.js';
import { BusinessRoleGuard } from './guards/business-role.guard.js';

// @Global(): every guard/decorator this module provides needs to be usable
// from any future resource module (accounts, and everything Prompt 5+
// adds) without that module explicitly importing this one -- see the long
// comment on RequireBusinessMembership() for why that specifically matters
// here (it breaks a would-be circular import between UserAuthModule,
// BusinessesModule, and AccountsModule). Registered once in AppModule.
@Global()
@Module({
  imports: [UserAuthModule],
  providers: [BusinessMembershipGuard, BusinessRoleGuard],
  exports: [UserAuthModule, BusinessMembershipGuard, BusinessRoleGuard],
})
export class BusinessAccessModule {}
