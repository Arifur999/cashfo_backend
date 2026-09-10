import { SetMetadata } from '@nestjs/common';
import { MemberRole } from '@prisma/client';

export const BUSINESS_ROLES_KEY = 'businessRoles';

// Restricts a route to specific BusinessMember roles (OWNER, ACCOUNTANT,
// STAFF), on top of the membership check @RequireBusinessMembership()
// already does. Omit this decorator entirely to allow any active member
// (STAFF included) -- see BusinessRoleGuard, which no-ops when no roles are
// set. Introduced in Prompt 4 for account create/edit/archive (STAFF is
// view-only) but reusable by every future prompt with the same
// "OWNER/ACCOUNTANT can write, STAFF can only view" shape.
export const RequireRole = (...roles: MemberRole[]) => SetMetadata(BUSINESS_ROLES_KEY, roles);
