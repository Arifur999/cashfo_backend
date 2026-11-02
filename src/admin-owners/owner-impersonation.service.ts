import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Role, UserStatus } from '@prisma/client';
import { AuthSessionsService, type ClientInfo } from '../auth/auth-sessions.service.js';
import { SessionTokensService } from '../auth/session-tokens.service.js';
import { END_USER_WHERE } from '../common/roles.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SupportAccessService } from '../support-access/support-access.service.js';

// How long one "View as customer" lasts before the admin is signed out of it.
export const IMPERSONATION_MINUTES = 60;

// "View as customer": a super admin sees the customer app as one customer
// sees it, to follow a support case. It is a real session of that customer,
// so every guard and query works as it does for them, marked with the
// admin's id -- which makes it read-only (UserAuthGuard), skips the
// workspace PIN, and lets the app show whose view it is. It is not a
// device: no UserSession row, so it stays out of their device list and the
// engagement analytics. Both ends land in the audit log.
//
// It opens only with the customer's consent: the one-time support code they
// made in Settings > Security (SupportAccessService). A refused code is
// logged too, so a run of guesses shows in the audit log.
@Injectable()
export class OwnerImpersonationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: AuthSessionsService,
    private readonly tokens: SessionTokensService,
    private readonly supportAccess: SupportAccessService,
  ) {}

  async start(userId: string, adminId: string, client: ClientInfo, code: string) {
    const owner = await this.prisma.user.findUnique({ where: { id: userId, ...END_USER_WHERE } });
    if (!owner) throw new NotFoundException('Owner not found');
    // better-auth's session hook refuses them too; this says why.
    if (owner.status !== UserStatus.ACTIVE) {
      throw new BadRequestException('Only an active account can be viewed. Activate it first.');
    }

    await this.supportAccess.requireConsent(userId, code, { adminId, refused: 'USER_IMPERSONATION_REFUSED', ipAddress: client.ipAddress });

    const expiresAt = new Date(Date.now() + IMPERSONATION_MINUTES * 60 * 1000);
    const sessionId = await this.sessions.create(userId, client);
    await this.prisma.$transaction([
      this.prisma.authSession.update({ where: { id: sessionId }, data: { impersonatedBy: adminId, expiresAt } }),
      this.prisma.auditLog.create({
        data: {
          adminUserId: adminId,
          action: 'USER_IMPERSONATION_STARTED',
          entityType: 'User',
          entityId: userId,
          newValue: { sensitive: true, readOnly: true, expiresInMinutes: IMPERSONATION_MINUTES, consent: 'support-code' },
          ipAddress: client.ipAddress,
        },
      }),
    ]);

    return { ...this.tokens.issue('user', { sub: userId, sid: sessionId, role: Role.USER }), expiresAt };
  }

  // Signs this admin out of every view of this customer they still have.
  async end(userId: string, adminId: string, ipAddress?: string) {
    const views = await this.prisma.authSession.findMany({ where: { userId, impersonatedBy: adminId }, select: { id: true } });
    for (const { id } of views) {
      await this.sessions.revoke(id);
    }
    if (views.length > 0) {
      await this.prisma.auditLog.create({
        data: {
          adminUserId: adminId,
          action: 'USER_IMPERSONATION_ENDED',
          entityType: 'User',
          entityId: userId,
          newValue: { sensitive: true },
          ipAddress,
        },
      });
    }
    return { ended: views.length };
  }
}
