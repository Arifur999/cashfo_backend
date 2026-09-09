import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminRole } from '@prisma/client';
import { Request } from 'express';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import { RequestAdminUser } from '../interfaces/request-admin-user.interface.js';

// Only one admin (SUPER_ADMIN) exists right now, but this checks against the
// full AdminRole enum so role-restricted routes work correctly once
// Prompt 2 adds SUPPORT_ADMIN/FINANCE_ADMIN/CONTENT_ADMIN accounts.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<AdminRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @Roles() decorator -- AdminAuthGuard already required authentication,
    // that's enough for this route.
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { adminUser?: RequestAdminUser }>();
    if (!request.adminUser) {
      return false;
    }

    return requiredRoles.includes(request.adminUser.role);
  }
}
