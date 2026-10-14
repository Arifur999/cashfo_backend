import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { User } from '@prisma/client';
import { AuthSessionsService, type ClientInfo } from '../auth/auth-sessions.service.js';
import { CredentialsService } from '../auth/credentials.service.js';
import { SessionTokensService } from '../auth/session-tokens.service.js';
import { isAdminRole } from '../common/roles.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ChangePasswordDto } from '../user-auth/dto/change-password.dto.js';
import { LoginDto } from './dto/login.dto.js';

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: AuthSessionsService,
    private readonly tokens: SessionTokensService,
    private readonly credentials: CredentialsService,
  ) {}

  async login(dto: LoginDto, client: ClientInfo) {
    const admin = await this.prisma.user.findUnique({ where: { email: dto.email } });

    // An end-user account is "no such admin" here -- same generic answer, so
    // the admin login can't be used to probe which emails have app accounts.
    if (!admin || !isAdminRole(admin.role)) {
      await this.recordLoginAttempt(dto.email, client, false, 'account_not_found');
      throw new UnauthorizedException('Invalid email or password');
    }
    if (admin.status !== 'ACTIVE') {
      await this.recordLoginAttempt(dto.email, client, false, 'account_suspended');
      throw new UnauthorizedException('This account has been suspended');
    }

    // better-auth checks the password and opens the session the tokens
    // below are bound to.
    const signedIn = await this.sessions.signInWithPassword(dto.email, dto.password, client);
    if (!signedIn) {
      await this.recordLoginAttempt(dto.email, client, false, 'invalid_password');
      throw new UnauthorizedException('Invalid email or password');
    }

    return this.completeSignIn(admin, signedIn.sessionId, client);
  }

  // Google sign-in ends on better-auth's callback, which leaves a session
  // cookie in the browser. The frontend forwards that cookie here and gets
  // the usual token pair, bound to that same session. An end user's session
  // is refused, not ended, so the frontend can exchange it on the user side.
  async exchangeSession(cookieHeader: string | undefined, client: ClientInfo) {
    const signedIn = await this.sessions.fromCookie(cookieHeader);
    if (!signedIn) {
      throw new UnauthorizedException('No signed-in session to exchange');
    }
    const admin = await this.prisma.user.findUniqueOrThrow({ where: { id: signedIn.userId } });
    if (!isAdminRole(admin.role)) {
      throw new ForbiddenException('This account does not sign in to the admin panel');
    }
    if (admin.status !== 'ACTIVE') {
      throw new UnauthorizedException('This account has been suspended');
    }
    return this.completeSignIn(admin, signedIn.sessionId, client);
  }

  // Shared by both ways in: stamps the login, audits it and issues the
  // token pair bound to the session.
  private async completeSignIn(admin: User, sessionId: string, client: ClientInfo) {
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } }),
      this.prisma.auditLog.create({
        data: {
          adminUserId: admin.id,
          action: 'ADMIN_LOGIN',
          entityType: 'AdminUser',
          entityId: admin.id,
          ipAddress: client.ipAddress,
        },
      }),
      this.prisma.loginAttempt.create({
        data: { email: admin.email, ipAddress: client.ipAddress ?? 'unknown', userAgent: client.userAgent, success: true },
      }),
    ]);

    return {
      ...this.tokens.issue('admin', { sub: admin.id, sid: sessionId, role: admin.role }),
      adminUser: { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
    };
  }

  private async recordLoginAttempt(email: string, client: ClientInfo, success: boolean, failureReason: string) {
    await this.prisma.loginAttempt.create({
      data: { email, ipAddress: client.ipAddress ?? 'unknown', userAgent: client.userAgent, success, failureReason },
    });
  }

  // A new access token for as long as the session lives -- logout, a
  // suspension or a password reset ends it, and with it this refresh.
  async refresh(refreshToken: string) {
    const { sub, sid } = this.tokens.verifyRefresh('admin', refreshToken);

    const session = await this.sessions.findActive(sid);
    if (!session || session.userId !== sub) {
      throw new UnauthorizedException('This session has been signed out');
    }
    const admin = session.user;
    if (!isAdminRole(admin.role) || admin.status !== 'ACTIVE') {
      throw new UnauthorizedException('Admin no longer active');
    }

    await this.sessions.touch(sid);
    return { accessToken: this.tokens.signAccess('admin', { sub, sid, role: admin.role }) };
  }

  async logout(refreshToken: string) {
    // Best-effort: an already-expired or malformed refresh token has no
    // session left to end, so don't fail the logout request over it.
    try {
      const { sid } = this.tokens.verifyRefresh('admin', refreshToken);
      await this.sessions.revoke(sid);
    } catch {
      // ignore
    }
    return { success: true };
  }

  // An admin's own password change. Until now only a super admin could set
  // one (and saw it), so an admin could never rotate a password that had
  // been shared or leaked. Every other session of the account is signed out.
  async changePassword(adminId: string, sessionId: string, dto: ChangePasswordDto, ipAddress?: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || !isAdminRole(admin.role)) {
      throw new UnauthorizedException('Admin no longer exists');
    }
    if (!(await this.credentials.verify(adminId, dto.currentPassword))) {
      throw new BadRequestException('Current password is incorrect');
    }
    await this.credentials.set(adminId, dto.newPassword);
    await this.sessions.revokeOthersForUser(adminId, sessionId);
    await this.prisma.auditLog.create({
      data: { adminUserId: adminId, action: 'ADMIN_PASSWORD_CHANGED', entityType: 'AdminUser', entityId: adminId, ipAddress },
    });
    return { success: true };
  }

  async me(adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || !isAdminRole(admin.role)) {
      throw new UnauthorizedException('Admin no longer exists');
    }
    return { id: admin.id, name: admin.name, email: admin.email, role: admin.role };
  }
}
