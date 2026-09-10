import { applyDecorators, UseGuards } from '@nestjs/common';
import { UserAuthGuard } from '../../user-auth/guards/user-auth.guard.js';
import { BusinessMembershipGuard } from '../guards/business-membership.guard.js';
import { BusinessRoleGuard } from '../guards/business-role.guard.js';

// The one reusable security pattern every workspace-scoped endpoint (this
// prompt and all future ones) must use: bundles UserAuthGuard (populates
// request.user) + BusinessMembershipGuard (confirms an ACTIVE membership on
// the :id/:businessId route param, populates request.businessMember) +
// BusinessRoleGuard (no-ops unless the route also has @RequireRole(...)) in
// the correct order, in one decorator.
//
// BusinessAccessModule (this folder's module) is @Global(), so unlike a
// normal Nest provider, no importing module needs to list it (or
// UserAuthModule) in its own `imports` just to use this decorator -- it's
// registered once in AppModule and available everywhere. This is
// deliberate: Prompt 4 needs UserAuthModule -> AccountsModule (to seed
// default accounts on signup) and BusinessesModule -> AccountsModule (to
// seed on workspace creation), and if this guard machinery required
// explicit per-module imports the way admin-side guards do, that would
// create a circular import (AccountsModule needing the guards back from
// wherever they lived). Making it global sidesteps that entirely and scales
// better as more resource modules (Prompt 5+) need the same check.
export function RequireBusinessMembership() {
  return applyDecorators(UseGuards(UserAuthGuard, BusinessMembershipGuard, BusinessRoleGuard));
}
