import { Prisma, UserStatus } from '@prisma/client';
import { END_USER_WHERE } from './roles.js';

// Who the admin's people figures count, shared by the Dashboard and
// Analytics so their "accounts" can never disagree.

// Every customer who signed up: a live workspace, or purged (no workspaces
// left) -- the Users list's "All" tab.
export const SIGNED_UP: Prisma.UserWhereInput = { ...END_USER_WHERE, OR: [{ ownedBusinesses: { some: { deletedAt: null } } }, { status: UserStatus.DELETED }] };

// Customers whose account is gone or going.
export const DELETED_STATUSES: UserStatus[] = [UserStatus.DELETED, UserStatus.PENDING_DELETION];

// Gone by `at`: deleted, or asked to be, before then. A deleted account with
// no request time on it counts as gone all along.
export const goneBy = (at: Date): Prisma.UserWhereInput => ({
  status: { in: DELETED_STATUSES },
  OR: [{ deletionRequestedAt: null }, { deletionRequestedAt: { lt: at } }],
});

// Customers who had signed up by `at` and were still there.
export const liveAt = (at: Date): Prisma.UserWhereInput => ({ ...SIGNED_UP, createdAt: { lt: at }, NOT: goneBy(at) });
