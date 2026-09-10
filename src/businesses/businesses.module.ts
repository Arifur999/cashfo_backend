import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module.js';
import { BusinessesController } from './businesses.controller.js';
import { BusinessesService } from './businesses.service.js';

// "Switching" the active workspace is a frontend-only concept (see Prompt 3
// spec): the backend is stateless about which workspace is "currently
// active" -- there's no server-side session field for it. The frontend
// stores the chosen businessId itself (user-frontend uses a cookie -- see
// its src/lib/activeBusiness.ts) and simply includes/implies it on whichever
// future requests need workspace context. Every workspace-scoped request
// still independently proves membership via @RequireBusinessMembership()
// regardless of what the frontend "thinks" is active.
//
// As of Prompt 4: @RequireBusinessMembership() (used by this controller's
// :id routes) no longer requires importing UserAuthModule/BusinessMembershipGuard
// here -- both are provided globally by BusinessAccessModule (registered
// once in AppModule). This module now imports AccountsModule instead, so
// create() can call AccountsService.seedDefaultAccounts() for new Business
// workspaces (mirroring UserAuthService.register()'s call for the
// auto-created default Personal one).
@Module({
  imports: [AccountsModule],
  controllers: [BusinessesController],
  providers: [BusinessesService],
})
export class BusinessesModule {}
