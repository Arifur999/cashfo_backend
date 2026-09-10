import { applyDecorators, UseGuards } from '@nestjs/common';
import { UserAuthGuard } from '../../user-auth/guards/user-auth.guard.js';
import { BusinessMembershipGuard } from '../guards/business-membership.guard.js';

// The one reusable security pattern every workspace-scoped endpoint (this
// prompt and all future ones) must use: `@RequireBusinessMembership()`
// bundles UserAuthGuard (populates request.user) + BusinessMembershipGuard
// (confirms an ACTIVE membership on the :id/:businessId route param,
// populates request.businessMember) in the correct order, in one decorator.
// Importing modules need BusinessesModule in their `imports` -- it exports
// both guards.
export function RequireBusinessMembership() {
  return applyDecorators(UseGuards(UserAuthGuard, BusinessMembershipGuard));
}
