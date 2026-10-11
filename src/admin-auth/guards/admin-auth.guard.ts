import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { SessionAuthenticator } from '../../auth/session-authenticator.service.js';
import { isAdminRole } from '../../common/roles.js';
import { RequestAdminUser } from '../interfaces/request-admin-user.interface.js';

// Verifies the access token and its live session, then attaches
// `request.adminUser`. Apply this before RolesGuard on any route that needs
// authentication -- RolesGuard assumes `request.adminUser` is already set.
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly authenticator: SessionAuthenticator) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { adminUser?: RequestAdminUser }>();
    const { user: admin, sessionId } = await this.authenticator.authenticate('admin', request);

    // Admins and end users share the User table: the role check is what keeps
    // an end-user account out of every admin route.
    if (!isAdminRole(admin.role)) {
      throw new UnauthorizedException('Admin no longer exists');
    }
    if (admin.status !== 'ACTIVE') {
      throw new UnauthorizedException('This admin account has been suspended');
    }

    request.adminUser = { id: admin.id, email: admin.email, role: admin.role, sessionId };
    return true;
  }
}
