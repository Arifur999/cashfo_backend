import { Role } from '@prisma/client';
import { ADMIN_ROLES, AdminRole, isAdminRole } from './roles.js';

describe('roles', () => {
  it('classifies every Role value', () => {
    // A new Role must be placed on one side on purpose -- this fails until it is.
    const nonUserRoles = Object.values(Role).filter((role) => role !== Role.USER);
    expect([...ADMIN_ROLES].sort()).toEqual(nonUserRoles.sort());
  });

  it('never treats an end user as an admin', () => {
    expect(isAdminRole(Role.USER)).toBe(false);
    expect(Object.values(AdminRole)).not.toContain(Role.USER);
  });

  it('accepts every admin role', () => {
    for (const role of ADMIN_ROLES) expect(isAdminRole(role)).toBe(true);
  });
});
