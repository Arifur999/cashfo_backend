import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

// TODO: Prompt 2 -- fill in real logic mirroring AdminAuthGuard: extract the
// Bearer token (or accessToken cookie), verify it against USER_JWT_SECRET,
// look up the User, check status === 'ACTIVE', and attach `request.user`.
// Not wired into any route yet -- Prompt 1 has no protected end-user routes.
@Injectable()
export class UserAuthGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    throw new Error('UserAuthGuard is not implemented yet -- see TODO: Prompt 2');
  }
}
