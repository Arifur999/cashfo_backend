import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AdminInvite } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { AdminAuthService } from '../admin-auth/admin-auth.service.js';
import { AuthSessionsService, type ClientInfo } from '../auth/auth-sessions.service.js';
import { CredentialsService } from '../auth/credentials.service.js';
import { dateLabel } from '../billing/billing-text.js';
import { isAdminRole, type AdminRole } from '../common/roles.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { groupSecret, matchTotp } from '../two-step/totp.js';
import { hashToken } from '../two-step/two-step-codes.js';
import { TwoStepService } from '../two-step/two-step.service.js';
import type { AcceptAdminInviteDto, CreateAdminInviteDto } from './dto/admin-invite.dto.js';
import { INVITE_TTL_MS, inviteState, resendWaitSec, ROLE_LABELS, type InviteState } from './invite-rules.js';

const INVALID_INVITE = 'This invite link is not valid any more. Ask a super admin to send a new one.';

const emailNotConfigured = () =>
  new ServiceUnavailableException({
    statusCode: 503,
    error: 'Service Unavailable',
    message: 'Email is not set up for the platform yet, so invites cannot be sent. Set a first password instead.',
    reason: 'EMAIL_NOT_CONFIGURED',
  });

const emailNotSent = () =>
  new ServiceUnavailableException({
    statusCode: 503,
    error: 'Service Unavailable',
    message: 'The invite email could not be sent. Try again in a minute, or set a first password instead.',
    reason: 'EMAIL_NOT_SENT',
  });

const invalidInvite = (reason: Exclude<InviteState, 'PENDING'> | 'NOT_FOUND') =>
  new BadRequestException({ statusCode: 400, error: 'Bad Request', message: INVALID_INVITE, reason: `INVITE_${reason}` });

// Security > Admin team > Invite an admin: a one-time link by email that
// works for seven days. Whoever opens it picks their name and password and
// turns on two-step sign-in, then lands in the admin panel signed in.
@Injectable()
export class AdminInvitesService {
  private readonly logger = new Logger(AdminInvitesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly credentials: CredentialsService,
    private readonly sessions: AuthSessionsService,
    private readonly twoStep: TwoStepService,
    private readonly adminAuth: AdminAuthService,
  ) {}

  // ---- Super admin ----

  async create(dto: CreateAdminInviteDto, inviterId: string, ipAddress?: string) {
    if (!this.mail.canDeliver) throw emailNotConfigured();
    await this.assertEmailFree(dto.email);

    const token = newInviteToken();
    const now = new Date();
    const invite = await this.prisma.$transaction(async (tx) => {
      // One open invite per address: a new one replaces any older one.
      await tx.adminInvite.updateMany({ where: { email: dto.email, acceptedAt: null, revokedAt: null }, data: { revokedAt: now } });
      const created = await tx.adminInvite.create({
        data: {
          email: dto.email,
          name: dto.name ?? null,
          role: dto.role,
          tokenHash: hashToken(token),
          invitedById: inviterId,
          expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
          lastSentAt: now,
        },
      });
      await tx.auditLog.create({
        data: {
          adminUserId: inviterId,
          action: 'ADMIN_INVITED',
          entityType: 'AdminInvite',
          entityId: created.id,
          newValue: { email: created.email, name: created.name, role: created.role, expiresAt: created.expiresAt.toISOString() },
          ipAddress,
        },
      });
      return created;
    });

    try {
      await this.sendInvite(invite, token);
    } catch (error) {
      this.logger.error(`Admin invite email to ${invite.email} failed: ${error instanceof Error ? error.message : String(error)}`);
      await this.prisma.adminInvite.update({ where: { id: invite.id }, data: { revokedAt: new Date() } });
      throw emailNotSent();
    }
    return { id: invite.id, email: invite.email, name: invite.name, role: invite.role, expiresAt: invite.expiresAt };
  }

  // Invites not yet accepted or revoked, newest first; an expired one stays
  // listed (status EXPIRED) so it can be sent again.
  async list() {
    const now = new Date();
    const invites = await this.prisma.adminInvite.findMany({
      where: { acceptedAt: null, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { invitedBy: { select: { id: true, name: true } } },
    });
    return invites.map((invite) => ({
      id: invite.id,
      email: invite.email,
      name: invite.name,
      role: invite.role,
      status: inviteState(invite, now) as 'PENDING' | 'EXPIRED',
      invitedBy: invite.invitedBy,
      createdAt: invite.createdAt,
      lastSentAt: invite.lastSentAt,
      expiresAt: invite.expiresAt,
    }));
  }

  // A new link and seven new days; the old link stops working.
  async resend(id: string, adminId: string, ipAddress?: string) {
    const invite = await this.requireOpen(id);
    if (!this.mail.canDeliver) throw emailNotConfigured();
    await this.assertEmailFree(invite.email);
    const now = new Date();
    const wait = resendWaitSec(invite.lastSentAt, now);
    if (wait > 0) {
      throw new HttpException(
        {
          statusCode: 429,
          error: 'Too Many Requests',
          message: `Wait ${wait} seconds before sending this invite again.`,
          reason: 'RESEND_TOO_SOON',
          retryAfterSec: wait,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const token = newInviteToken();
    const updated = await this.prisma.adminInvite.update({
      where: { id },
      // The accept page shows a new two-step key for the new link.
      data: { tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + INVITE_TTL_MS), lastSentAt: now, pendingSecretCiphertext: null },
    });
    try {
      await this.sendInvite(updated, token);
    } catch (error) {
      this.logger.error(`Admin invite email to ${updated.email} failed: ${error instanceof Error ? error.message : String(error)}`);
      await this.prisma.adminInvite.update({ where: { id }, data: { lastSentAt: invite.lastSentAt } });
      throw emailNotSent();
    }
    await this.prisma.auditLog.create({
      data: {
        adminUserId: adminId,
        action: 'ADMIN_INVITE_RESENT',
        entityType: 'AdminInvite',
        entityId: id,
        newValue: { email: updated.email, expiresAt: updated.expiresAt.toISOString() },
        ipAddress,
      },
    });
    return { id: updated.id, email: updated.email, name: updated.name, role: updated.role, expiresAt: updated.expiresAt };
  }

  async revoke(id: string, adminId: string, ipAddress?: string) {
    const invite = await this.requireOpen(id);
    await this.prisma.$transaction([
      this.prisma.adminInvite.update({ where: { id }, data: { revokedAt: new Date(), pendingSecretCiphertext: null } }),
      this.prisma.auditLog.create({
        data: {
          adminUserId: adminId,
          action: 'ADMIN_INVITE_REVOKED',
          entityType: 'AdminInvite',
          entityId: id,
          oldValue: { email: invite.email, role: invite.role },
          ipAddress,
        },
      }),
    ]);
    return { success: true };
  }

  // ---- The invited person (public, by the link's token) ----

  // What the accept page shows, or why the link no longer works.
  async check(token: string) {
    const invite = await this.prisma.adminInvite.findUnique({ where: { tokenHash: hashToken(token) }, include: { invitedBy: { select: { name: true } } } });
    if (!invite) return { valid: false as const, reason: 'NOT_FOUND' as const };
    const state = inviteState(invite, new Date());
    if (state !== 'PENDING') return { valid: false as const, reason: state };
    return {
      valid: true as const,
      email: invite.email,
      name: invite.name,
      role: invite.role,
      invitedByName: invite.invitedBy.name,
      expiresAt: invite.expiresAt,
    };
  }

  // The two-step key for the accept page: made once per link and kept
  // (sealed) on the invite, so reloading the page shows the same QR code.
  async twoStepSecret(token: string) {
    const invite = await this.requireUsable(token);
    let secret: string;
    if (invite.pendingSecretCiphertext) {
      secret = this.twoStep.open(invite.pendingSecretCiphertext);
    } else {
      secret = this.twoStep.newSecret();
      const { count } = await this.prisma.adminInvite.updateMany({
        where: { id: invite.id, pendingSecretCiphertext: null },
        data: { pendingSecretCiphertext: this.twoStep.seal(secret) },
      });
      // Another tab got there first: show the key it stored.
      if (count === 0) {
        const stored = await this.prisma.adminInvite.findUniqueOrThrow({ where: { id: invite.id }, select: { pendingSecretCiphertext: true } });
        secret = this.twoStep.open(stored.pendingSecretCiphertext!);
      }
    }
    return { secret: groupSecret(secret), otpauthUrl: await this.twoStep.otpauthUrl('admin', invite.email, secret) };
  }

  // Creates the admin with the invite's role, their password and two-step
  // turned on from the key the page showed, uses the invite up, and signs
  // them in: {audience: 'admin', accessToken, refreshToken, account,
  // backupCodes} -- the ten backup codes shown once.
  async accept(dto: AcceptAdminInviteDto, client: ClientInfo) {
    const invite = await this.requireUsable(dto.token);
    if (!invite.pendingSecretCiphertext) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Scan the code with your authenticator app first.',
        reason: 'TWO_STEP_NOT_STARTED',
      });
    }
    const secret = this.twoStep.open(invite.pendingSecretCiphertext);
    const step = matchTotp(secret, dto.code, new Date());
    if (step === null) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: "That code didn't work. Check the app and try again.",
        reason: 'CODE_WRONG',
      });
    }
    await this.assertEmailFree(invite.email);
    if (!isAdminRole(invite.role)) throw invalidInvite('REVOKED');

    const { admin, backupCodes } = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      // Claim the invite first: two tabs accepting at once both pass the
      // checks above, but only one can set acceptedAt.
      const { count } = await tx.adminInvite.updateMany({
        where: { id: invite.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
        data: { acceptedAt: now },
      });
      if (count !== 1) throw invalidInvite('ACCEPTED');
      const created = await tx.user.create({
        // The invite went to this address, which vouches for it -- and lets
        // better-auth link the address's Google sign-in to the account.
        data: { name: dto.name, email: invite.email, role: invite.role, createdBy: invite.invitedById, emailVerified: true, emailVerifiedAt: now },
      });
      await this.credentials.set(created.id, dto.password, tx);
      await tx.twoFactor.create({
        data: { userId: created.id, secretCiphertext: invite.pendingSecretCiphertext!, enabledAt: now, lastUsedStep: BigInt(step) },
      });
      const codes = await this.twoStep.replaceBackupCodes(created.id, tx);
      await tx.adminInvite.update({ where: { id: invite.id }, data: { acceptedUserId: created.id, pendingSecretCiphertext: null } });
      await tx.auditLog.create({
        data: {
          adminUserId: created.id,
          action: 'ADMIN_INVITE_ACCEPTED',
          entityType: 'AdminInvite',
          entityId: invite.id,
          newValue: { adminId: created.id, email: created.email, role: created.role, invitedById: invite.invitedById },
          ipAddress: client.ipAddress,
        },
      });
      return { admin: created, backupCodes: codes };
    });

    const sessionId = await this.sessions.create(admin.id, client);
    const { accessToken, refreshToken, adminUser } = await this.adminAuth.finishSignIn(admin, sessionId, client);
    return { audience: 'admin' as const, accessToken, refreshToken, account: adminUser, backupCodes };
  }

  // Invites past their end keep no two-step key.
  async cleanup(now: Date): Promise<void> {
    await this.prisma.adminInvite.updateMany({
      where: { expiresAt: { lt: now }, pendingSecretCiphertext: { not: null } },
      data: { pendingSecretCiphertext: null },
    });
  }

  // ---- Internals ----

  private async sendInvite(invite: AdminInvite, token: string) {
    const inviter = await this.prisma.user.findUnique({ where: { id: invite.invitedById }, select: { name: true } });
    const role = ROLE_LABELS[invite.role as AdminRole];
    await this.mail.sendAdminInviteEmail(invite.email, {
      name: invite.name,
      inviterName: inviter?.name ?? 'A super admin',
      role,
      link: `${this.adminFrontendUrl()}/admin/invite?token=${encodeURIComponent(token)}`,
      expires: { en: dateLabel(invite.expiresAt, 'en'), bn: dateLabel(invite.expiresAt, 'bn') },
    });
  }

  private async assertEmailFree(email: string) {
    // Any account, not just admins: end users share the table and its email.
    const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw new ConflictException('An account with this email already exists');
  }

  private async requireOpen(id: string) {
    const invite = await this.prisma.adminInvite.findUnique({ where: { id } });
    if (!invite || invite.acceptedAt || invite.revokedAt) throw new NotFoundException('Invite not found');
    return invite;
  }

  private async requireUsable(token: string) {
    const invite = await this.prisma.adminInvite.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!invite) throw invalidInvite('NOT_FOUND');
    const state = inviteState(invite, new Date());
    if (state !== 'PENDING') throw invalidInvite(state);
    return invite;
  }

  private adminFrontendUrl() {
    return this.config.get<string>('ADMIN_FRONTEND_URL') ?? 'http://localhost:3000';
  }
}

const newInviteToken = () => randomBytes(32).toString('base64url');
