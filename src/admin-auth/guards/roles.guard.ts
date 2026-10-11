import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AdminRole } from '../../common/roles.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import { RequestAdminUser } from '../interfaces/request-admin-user.interface.js';

// Narrows an admin route to specific admin roles. Whether the caller is an
// admin at all is AdminAuthGuard's job (it rejects role USER), so this only
// ever compares one admin role against another.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<AdminRole[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);

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
