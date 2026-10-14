import { CanActivate, ExecutionContext, ForbiddenException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ALLOW_LOCKED_WORKSPACE } from '../decorators/allow-locked-workspace.decorator.js';
import { RequestBusinessMember } from '../interfaces/request-business-member.interface.js';
import { WORKSPACE_UNLOCK_HEADER, WorkspaceUnlockService } from '../workspace-unlock.service.js';
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
//
// A workspace with a PIN also needs the unlock POST :id/verify-pin hands
// out, in the x-workspace-unlock header; without it the answer is 423
// WORKSPACE_LOCKED (after the membership check, so only members learn a
// workspace is locked).
@Injectable()
export class BusinessMembershipGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
    private readonly unlocks: WorkspaceUnlockService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: RequestUser; businessMember?: RequestBusinessMember }>();
    const businessId = String(request.params.businessId ?? request.params.id ?? '');
    const user = request.user;

    if (!businessId || !user?.id) {
      throw new ForbiddenException('You do not have access to this workspace');
    }

    const membership = await this.prisma.businessMember.findUnique({
      where: { businessId_userId: { businessId, userId: user.id } },
      include: { business: { select: { deletedAt: true, pinHash: true } } },
    });

    // A deleted workspace is gone for everyone: without the deletedAt check
    // its owner could keep reading and posting into it by URL.
    if (!membership || membership.status !== 'ACTIVE' || membership.business.deletedAt) {
      throw new ForbiddenException('You do not have access to this workspace');
    }

    const { pinHash } = membership.business;
    if (pinHash && !this.reflector.getAllAndOverride<boolean>(ALLOW_LOCKED_WORKSPACE, [context.getHandler(), context.getClass()])) {
      const header = request.headers[WORKSPACE_UNLOCK_HEADER];
      const token = Array.isArray(header) ? header[0] : header;
      if (!this.unlocks.opens(token, user.id, user.sessionId, businessId, pinHash)) {
        throw new HttpException(
          { statusCode: HttpStatus.LOCKED, error: 'WORKSPACE_LOCKED', message: 'This workspace is locked. Enter its PIN to open it.', businessId },
          HttpStatus.LOCKED,
        );
      }
    }

    request.businessMember = { businessId: membership.businessId, userId: membership.userId, role: membership.role };
    return true;
  }
}
