import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service.js';
import { RequestBusinessMember } from '../interfaces/request-business-member.interface.js';
import { RequestUser } from '../../user-auth/interfaces/request-user.interface.js';

// Must run AFTER UserAuthGuard (request.user must already be set) -- use the
// @RequireBusinessMembership() composed decorator below rather than applying
// this guard alone, so ordering is never a foot-gun.
//
// Reads the target business id from :businessId (nested routes, e.g.
// /api/businesses/:businessId/accounts) or :id (workspace-is-the-resource
// routes, e.g. GET /api/businesses/:id). Confirms an ACTIVE BusinessMember
// row exists and attaches it as `request.businessMember` so downstream
// handlers (and BusinessRoleGuard) can check `.role` without a second query.
//
// Returns the same generic 403 whether the business doesn't exist at all or
// simply isn't one this user belongs to -- never reveals which.
@Injectable()
export class BusinessMembershipGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: RequestUser; businessMember?: RequestBusinessMember }>();
    const businessId = String(request.params.businessId ?? request.params.id ?? '');
    const userId = request.user?.id;

    if (!businessId || !userId) {
      throw new ForbiddenException('You do not have access to this workspace');
    }

    const membership = await this.prisma.businessMember.findUnique({
      where: { businessId_userId: { businessId, userId } },
    });

    if (!membership || membership.status !== 'ACTIVE') {
      throw new ForbiddenException('You do not have access to this workspace');
    }

    request.businessMember = { businessId: membership.businessId, userId: membership.userId, role: membership.role };
    return true;
  }
}
