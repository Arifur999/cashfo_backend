import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role, type User } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { AuthSessionsService, type ClientInfo } from '../auth/auth-sessions.service.js';
import { CredentialsService } from '../auth/credentials.service.js';
import { SessionTokensService } from '../auth/session-tokens.service.js';
import { MailService } from '../mail/mail.service.js';
import { renderPasswordResetEmail } from '../mail/templates/password-reset-email.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { UserProvisioningService } from './user-provisioning.service.js';
import { UserSessionsService } from './user-sessions.service.js';

const INVALID_RESET_LINK = 'This reset link is invalid or has expired. Please request a new one.';

@Injectable()
export class UserAuthService {
  private readonly logger = new Logger(UserAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
    private readonly credentials: CredentialsService,
    private readonly sessions: AuthSessionsService,
    private readonly tokens: SessionTokensService,
    private readonly devices: UserSessionsService,
    private readonly provisioning: UserProvisioningService,
  ) {}

  async register(dto: RegisterDto, client: ClientInfo) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    // better-auth creates the account and its credential, then signs it in.
    // emailVerifiedAt stays null -- an email verification flow is still a
    // separate future feature.
    const signedIn = await this.sessions.signUpWithPassword(
      { name: dto.name, email: dto.email, password: dto.password, phone: dto.phone, preferredLanguage: dto.preferredLanguage },
      client,
    );
    if (!signedIn) {
      throw new ConflictException('An account with this email already exists');
    }

    const defaultBusinessId = await this.provisioning.ensureDefaultWorkspace(signedIn.userId, { referralCode: dto.referralCode });
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: signedIn.userId } });
    return this.signedInResponse(user, signedIn.sessionId, client, defaultBusinessId);
  }

  async login(dto: LoginDto, client: ClientInfo) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });

    // DELETED is treated the same as "no account" -- a soft-deleted account
    // shouldn't reveal its own existence any more than a nonexistent email
    // would -- and so is an admin account, which signs in on the admin side.
    // SUSPENDED gets a distinct, honest message (spec's explicit completion
    // criterion): the owner should know the account is theirs and how to
    // resolve it.
    if (!user || user.status === 'DELETED' || user.role !== Role.USER) {
      await this.recordLoginAttempt(dto.email, client, false, 'account_not_found');
      throw new UnauthorizedException('Invalid email or password');
    }
    if (user.status === 'SUSPENDED') {
      await this.recordLoginAttempt(dto.email, client, false, 'account_suspended');
      throw new ForbiddenException('Your account has been suspended. Contact support for assistance.');
    }

    const signedIn = await this.sessions.signInWithPassword(dto.email, dto.password, client);
    if (!signedIn) {
      await this.recordLoginAttempt(dto.email, client, false, 'invalid_password');
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
      this.prisma.loginAttempt.create({
        data: { email: dto.email, ipAddress: client.ipAddress ?? 'unknown', userAgent: client.userAgent, success: true },
      }),
    ]);

    // Also completes an account created elsewhere that has no workspace yet.
    const defaultBusinessId = await this.provisioning.ensureDefaultWorkspace(user.id);
    return this.signedInResponse(user, signedIn.sessionId, client, defaultBusinessId);
  }

  // Google sign-in ends on better-auth's callback, which leaves a session
  // cookie in the browser. The frontend forwards that cookie here and gets
  // the usual token pair, bound to that same session. An admin's session is
  // refused, not ended, so the frontend can exchange it on the admin side.
  async exchangeSession(cookieHeader: string | undefined, client: ClientInfo, referralCode?: string) {
    const signedIn = await this.sessions.fromCookie(cookieHeader);
    if (!signedIn) {
      throw new UnauthorizedException('No signed-in session to exchange');
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: signedIn.userId } });
    if (user.role !== Role.USER) {
      throw new ForbiddenException('This account signs in to the admin panel');
    }
    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException('Your account has been suspended. Contact support for assistance.');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
      this.prisma.loginAttempt.create({
        data: { email: user.email, ipAddress: client.ipAddress ?? 'unknown', userAgent: client.userAgent, success: true },
      }),
    ]);
    // A first Google sign-in is also the signup: this creates the workspace
    // and records the referral the invite link carried.
    const defaultBusinessId = await this.provisioning.ensureDefaultWorkspace(user.id, { referralCode });
    return this.signedInResponse(user, signedIn.sessionId, client, defaultBusinessId);
  }

  // Shared by register/login/resetPassword: records the device for Device
  // Management and issues the token pair bound to its session.
  private async signedInResponse(user: User, sessionId: string, client: ClientInfo, defaultBusinessId: string) {
    await this.devices.record(user.id, sessionId, client);
    return {
      ...this.tokens.issue('user', { sub: user.id, sid: sessionId, role: user.role }),
      user: { id: user.id, name: user.name, email: user.email, preferredLanguage: user.preferredLanguage },
      defaultBusinessId,
    };
  }

  private async recordLoginAttempt(email: string, client: ClientInfo, success: boolean, failureReason: string) {
    await this.prisma.loginAttempt.create({
      data: { email, ipAddress: client.ipAddress ?? 'unknown', userAgent: client.userAgent, success, failureReason },
    });
  }

  // A new access token for as long as the device's session lives -- logout,
  // revoking the device, a suspension or a password reset ends it.
  async refresh(refreshToken: string) {
    const { sub, sid } = this.tokens.verifyRefresh('user', refreshToken);

    const session = await this.sessions.findActive(sid);
    if (!session || session.userId !== sub) {
      throw new UnauthorizedException('This session has been signed out');
    }
    if (session.user.status !== 'ACTIVE' || session.user.role !== Role.USER) {
      throw new UnauthorizedException('Account no longer active');
    }

    await this.devices.touch(sid);
    return { accessToken: this.tokens.signAccess('user', { sub, sid, role: session.user.role }) };
  }

  async logout(refreshToken: string) {
    // Best-effort: an already-expired or malformed refresh token has no
    // session left to end, so don't fail the logout request over it.
    try {
      const { sid } = this.tokens.verifyRefresh('user', refreshToken);
      await this.devices.end(sid);
    } catch {
      // ignore
    }
    return { success: true };
  }

  // Signs every other device out: changing the password is what someone
  // does when they think the account was taken over, and the old sessions
  // would otherwise keep working until they expire.
  async changePassword(userId: string, sessionId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Account no longer exists');
    }

    const currentMatches = await this.credentials.verify(userId, dto.currentPassword);
    if (!currentMatches) {
      throw new BadRequestException('Current password is incorrect');
    }

    await this.credentials.set(userId, dto.newPassword);
    await this.devices.endAllExcept(userId, sessionId);
    return { success: true };
  }

  // "Forgot password?" on the login page. Always resolves to the same
  // generic {success: true} regardless of whether the email matched a real,
  // ACTIVE end-user account -- same "don't reveal account existence"
  // instinct as login()'s identical invalid-email/invalid-password message.
  // Admin passwords are reset by a super admin, never by email link.
  async forgotPassword(email: string): Promise<{ success: true }> {
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (user && user.status === 'ACTIVE' && user.role === Role.USER) {
      const rawToken = randomBytes(32).toString('hex');
      // sha256, not bcrypt -- the token already carries 256 bits of its own
      // entropy (unlike a human password), so a deterministic hash is fine
      // and lets resetPassword() below look it up with a plain unique query
      // instead of bcrypt.compare-ing against every unexpired row.
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

      await this.prisma.$transaction([
        // Only the newest link should ever work -- supersede anything still
        // outstanding for this user rather than leaving multiple valid ones.
        this.prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }),
        this.prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash, expiresAt } }),
      ]);

      const frontendUrl = this.configService.get<string>('USER_FRONTEND_URL') ?? 'http://localhost:3001';
      const resetUrl = `${frontendUrl}/reset-password?token=${rawToken}`;
      const resetEmail = renderPasswordResetEmail(user.name, resetUrl);
      try {
        await this.mailService.sendEmail({ to: user.email, ...resetEmail });
      } catch (err: unknown) {
        // Unlike the welcome email, this one isn't fire-and-forget -- but a
        // send failure still must not change the generic response below, or
        // it becomes an account-existence oracle (fails only for real emails).
        this.logger.error(`Failed to send password reset email to ${user.email}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { success: true };
  }

  // The link from forgotPassword()'s email. Consuming it signs the account
  // out on every device -- changing your password signs you out everywhere
  // else -- then signs the caller in fresh, same response shape as
  // login()/register(), so the frontend can set cookies and go straight on.
  async resetPassword(rawToken: string, newPassword: string, client: ClientInfo) {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const resetToken = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
      throw new BadRequestException(INVALID_RESET_LINK);
    }

    const user = await this.prisma.$transaction(async (tx) => {
      // Claim the token first, conditionally: two requests racing with the
      // same link both pass the read above, but only one can flip usedAt
      // from null -- the other gets count 0 and is refused, so a link really
      // is single-use.
      const now = new Date();
      const { count } = await tx.passwordResetToken.updateMany({
        where: { id: resetToken.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (count !== 1) {
        throw new BadRequestException(INVALID_RESET_LINK);
      }
      // A link mailed while the account was active must not work after it has
      // been suspended or deleted -- that would both change the password and
      // log the user in, bypassing login()'s status checks. Same generic
      // message, so the link doesn't reveal the account's status.
      const owner = await tx.user.findUnique({ where: { id: resetToken.userId } });
      if (owner?.status !== 'ACTIVE' || owner.role !== Role.USER) {
        throw new BadRequestException(INVALID_RESET_LINK);
      }
      await this.credentials.set(owner.id, newPassword, tx);
      return owner;
    });

    await this.devices.endAll(user.id);
    const sessionId = await this.sessions.create(user.id, client);
    const defaultBusinessId = await this.provisioning.ensureDefaultWorkspace(user.id);
    return this.signedInResponse(user, sessionId, client, defaultBusinessId);
  }
}
