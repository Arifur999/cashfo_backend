import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { AuthSessionsService } from '../auth/auth-sessions.service.js';
import { CredentialsService } from '../auth/credentials.service.js';
import { isAdminRole } from '../common/roles.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { hashToken } from '../two-step/two-step-codes.js';
import { ADMIN_RESET_TTL_MS, adminResetUsable } from './invite-rules.js';

const INVALID_RESET_LINK = 'This reset link is invalid or has expired. Please request a new one.';

// "Forgot password?" on the admin sign-in page (AdminForgotPassword): a link
// by email that works once, for 30 minutes. It reuses PasswordResetToken
// with the customers' reset, but its own pages and checks: a customer's link
// never works here, nor an admin's on the customer page. Using it signs the
// admin out everywhere and hands out no tokens -- they sign in again, and
// two-step still applies.
@Injectable()
export class AdminPasswordResetService {
  private readonly logger = new Logger(AdminPasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly credentials: CredentialsService,
    private readonly sessions: AuthSessionsService,
  ) {}

  // Always the same answer, whether or not the email is an admin's.
  async forgot(email: string): Promise<{ success: true }> {
    const admin = await this.prisma.user.findUnique({ where: { email } });
    if (!admin || !isAdminRole(admin.role) || admin.status !== 'ACTIVE') return { success: true };
    if (!this.mail.canDeliver) {
      this.logger.warn(`Admin ${admin.email} asked for a reset link, but email is not set up (a super admin can set a new password)`);
      return { success: true };
    }

    const rawToken = randomBytes(32).toString('hex');
    await this.prisma.$transaction([
      // Only the newest link ever works.
      this.prisma.passwordResetToken.updateMany({ where: { userId: admin.id, usedAt: null }, data: { usedAt: new Date() } }),
      this.prisma.passwordResetToken.create({
        data: { userId: admin.id, tokenHash: hashToken(rawToken), expiresAt: new Date(Date.now() + ADMIN_RESET_TTL_MS) },
      }),
    ]);
    const link = `${this.config.get<string>('ADMIN_FRONTEND_URL') ?? 'http://localhost:3000'}/admin/reset-password?token=${rawToken}`;
    try {
      await this.mail.sendAdminPasswordResetEmail(admin.email, admin.preferredLanguage === 'BN' ? 'bn' : 'en', {
        name: admin.name,
        link,
        minutes: ADMIN_RESET_TTL_MS / 60_000,
      });
    } catch (error) {
      // Must not change the answer, or it tells which emails are admins'.
      this.logger.error(`Admin password reset email to ${admin.email} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { success: true };
  }

  async check(rawToken: string): Promise<{ valid: boolean }> {
    const token = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
    const owner = token ? await this.prisma.user.findUnique({ where: { id: token.userId }, select: { status: true, role: true } }) : null;
    return { valid: adminResetUsable(token, owner && { status: owner.status, isAdmin: isAdminRole(owner.role) }, new Date()) };
  }

  async reset(rawToken: string, password: string, ipAddress?: string): Promise<{ success: true }> {
    const token = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
    if (!token) throw new BadRequestException(INVALID_RESET_LINK);

    const admin = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      // Claim it first: of two requests racing with one link, one wins.
      const { count } = await tx.passwordResetToken.updateMany({ where: { id: token.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
      if (count !== 1) throw new BadRequestException(INVALID_RESET_LINK);
      const owner = await tx.user.findUnique({ where: { id: token.userId } });
      if (!owner || owner.status !== 'ACTIVE' || !isAdminRole(owner.role)) throw new BadRequestException(INVALID_RESET_LINK);
      // Also ends every computer trusted to skip the two-step code.
      await this.credentials.set(owner.id, password, tx);
      await tx.auditLog.create({
        data: { adminUserId: owner.id, action: 'ADMIN_PASSWORD_RESET_BY_EMAIL', entityType: 'AdminUser', entityId: owner.id, ipAddress },
      });
      return owner;
    });
    await this.sessions.revokeAllForUser(admin.id);
    return { success: true };
  }
}
