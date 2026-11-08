import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { Request } from 'express';
import { SessionAuthenticator } from '../../auth/session-authenticator.service.js';
import { GROUP_MEMBER_ROUTE } from '../../business-access/decorators/group-member-route.decorator.js';
import { RequestUser } from '../interfaces/request-user.interface.js';

// Verifies the end-user access token and its live session, then attaches
// `request.user`. End-user tokens are signed with USER_JWT_SECRET, separate
// from the admin secret, so an admin token can never be replayed against
// end-user routes, or vice versa. Mirrors AdminAuthGuard's shape exactly.
//
// A super admin's "View as customer" session (AdminOwnersController's
// impersonate) only reads: anything but GET is refused, so support can see
// what the customer sees without changing it.
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// A group member's portal login (User.portalOnly) opens only the routes
// marked @GroupMemberRoute(): its groups and its own account basics.

@Injectable()
export class UserAuthGuard implements CanActivate {
  constructor(
    private readonly authenticator: SessionAuthenticator,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: RequestUser }>();
    const { user, sessionId, impersonatedBy } = await this.authenticator.authenticate('user', request);

    if (user.role !== Role.USER || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('This account is not active');
    }

    if (impersonatedBy && !READ_METHODS.has(request.method)) {
      throw new ForbiddenException('This is a read-only support view of the account. Nothing can be changed from it.');
    }

    if (user.portalOnly && !this.reflector.getAllAndOverride<boolean>(GROUP_MEMBER_ROUTE, [context.getHandler(), context.getClass()])) {
      throw new ForbiddenException('This login opens only your groups.');
    }

    request.user = { id: user.id, email: user.email, sessionId, ...(impersonatedBy && { impersonatedBy }) };
    return true;
  }
}
