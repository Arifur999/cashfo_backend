import { Prisma, Role } from '@prisma/client';

// End users and the admin team share the User table; `role` is what tells
// them apart. AdminRole is the admin side of Role -- a const object rather
// than a bare type, so call sites keep reading `AdminRole.SUPER_ADMIN`,
// `@IsEnum(AdminRole)` accepts exactly these values, and USER can never be
// handed out from the admin panel.
export const AdminRole = {
  SUPER_ADMIN: Role.SUPER_ADMIN,
  SUPPORT_ADMIN: Role.SUPPORT_ADMIN,
  FINANCE_ADMIN: Role.FINANCE_ADMIN,
  CONTENT_ADMIN: Role.CONTENT_ADMIN,
} as const;
export type AdminRole = (typeof AdminRole)[keyof typeof AdminRole];

export const ADMIN_ROLES: readonly AdminRole[] = Object.values(AdminRole);

// Membership, not `role !== USER`: a role added to the enum later stays
// out of the admin panel until it is listed above.
export const isAdminRole = (role: Role): role is AdminRole => (ADMIN_ROLES as readonly Role[]).includes(role);

export const END_USER_WHERE = { role: Role.USER } satisfies Prisma.UserWhereInput;
export const ADMIN_USER_WHERE = { role: { in: [...ADMIN_ROLES] } } satisfies Prisma.UserWhereInput;
