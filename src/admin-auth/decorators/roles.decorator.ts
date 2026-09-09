import { SetMetadata } from '@nestjs/common';
import { AdminRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

// @Roles() with no args on a route protected by AdminAuthGuard means "any
// authenticated admin, regardless of role" -- RolesGuard passes when no
// roles are attached at all, so using this decorator is only needed when you
// want to actually restrict to specific roles.
export const Roles = (...roles: AdminRole[]) => SetMetadata(ROLES_KEY, roles);
