import { Module } from '@nestjs/common';
import { UserAuthModule } from '../user-auth/user-auth.module.js';
import { BusinessesController } from './businesses.controller.js';
import { BusinessesService } from './businesses.service.js';
import { BusinessMembershipGuard } from './guards/business-membership.guard.js';

// "Switching" the active workspace is a frontend-only concept (see Prompt 3
// spec): the backend is stateless about which workspace is "currently
// active" -- there's no server-side session field for it. The frontend
// stores the chosen businessId itself (user-frontend uses a cookie -- see
// its src/lib/activeBusiness.ts) and simply includes/implies it on whichever
// future requests need workspace context. Every workspace-scoped request
// still independently proves membership via @RequireBusinessMembership()
// regardless of what the frontend "thinks" is active.
//
// Exports BusinessMembershipGuard (+ UserAuthModule, transitively) so any
// future module (Prompt 4+: accounts, transactions, etc.) can just import
// BusinessesModule to get everything @RequireBusinessMembership() needs.
@Module({
  imports: [UserAuthModule],
  controllers: [BusinessesController],
  providers: [BusinessesService, BusinessMembershipGuard],
  exports: [UserAuthModule, BusinessMembershipGuard],
})
export class BusinessesModule {}
