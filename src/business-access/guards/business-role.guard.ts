import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MemberRole } from '@prisma/client';
import { BUSINESS_ROLES_KEY } from '../decorators/require-role.decorator.js';
import { RequestBusinessMember } from '../interfaces/request-business-member.interface.js';

// Must run AFTER BusinessMembershipGuard (request.businessMember must
// already be set) -- always included in @RequireBusinessMembership()'s
// guard chain, so it's never applied standalone. No-ops (returns true) when
// the route has no @RequireRole() metadata, so it's safe to always be in
// that chain even for routes any member may access.
@Injectable()
export class BusinessRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // getAllAndOverride (not plain get()) so @RequireRole() works whether
    // it's applied on the individual route handler (e.g. AccountsController's
    // per-method usage) OR on the whole controller class (e.g.
    // QuickEntriesController, where every route needs the same
    // restriction) -- a plain reflector.get(key, context.getHandler())
    // only ever sees method-level metadata and silently ignores a
    // class-level @RequireRole(), which let STAFF through undetected until
    // this was caught in testing.
    const roles = this.reflector.getAllAndOverride<MemberRole[] | undefined>(BUSINESS_ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!roles || roles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ businessMember?: RequestBusinessMember }>();
    const member = request.businessMember;
    if (!member || !roles.includes(member.role)) {
      throw new ForbiddenException('You do not have permission to do this');
    }
    return true;
  }
}
