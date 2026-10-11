import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Request } from 'express';
import { SessionAuthenticator } from '../../auth/session-authenticator.service.js';
import { RequestUser } from '../interfaces/request-user.interface.js';

// Verifies the end-user access token and its live session, then attaches
// `request.user`. End-user tokens are signed with USER_JWT_SECRET, separate
// from the admin secret, so an admin token can never be replayed against
// end-user routes, or vice versa. Mirrors AdminAuthGuard's shape exactly.
@Injectable()
export class UserAuthGuard implements CanActivate {
  constructor(private readonly authenticator: SessionAuthenticator) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: RequestUser }>();
    const { user, sessionId } = await this.authenticator.authenticate('user', request);

    if (user.role !== Role.USER || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('This account is not active');
    }

    request.user = { id: user.id, email: user.email, sessionId };
    return true;
  }
}
