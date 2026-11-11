import { SetMetadata } from '@nestjs/common';

export const GROUP_MEMBER_ROUTE = 'groupMemberRoute';

// A route a group member who isn't the group's owner may use. Two guards
// read it:
// - UserAuthGuard: a member-portal login (User.portalOnly) reaches only
//   these routes -- its groups, its own account basics -- and nothing else
//   the customer API has.
// - BusinessMembershipGuard: inside a GROUP workspace, a Viewer (STAFF) or
//   Editor (ACCOUNTANT) reaches only these; the workspace's other modules
//   (accounts, transactions, contacts, ...) stay the owner's.
// Roles still apply on top (@RequireRole), as everywhere.
export const GroupMemberRoute = () => SetMetadata(GROUP_MEMBER_ROUTE, true);
