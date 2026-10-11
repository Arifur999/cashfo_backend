import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthSessionsService, type ClientInfo } from '../auth/auth-sessions.service.js';
import { SessionTokensService } from '../auth/session-tokens.service.js';
import { isAdminRole } from '../common/roles.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { LoginDto } from './dto/login.dto.js';

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: AuthSessionsService,
    private readonly tokens: SessionTokensService,
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
        data: { email: dto.email, ipAddress: client.ipAddress ?? 'unknown', userAgent: client.userAgent, success: true },
      }),
    ]);

    return {
      ...this.tokens.issue('admin', { sub: admin.id, sid: signedIn.sessionId, role: admin.role }),
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

  async me(adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || !isAdminRole(admin.role)) {
      throw new UnauthorizedException('Admin no longer exists');
    }
    return { id: admin.id, name: admin.name, email: admin.email, role: admin.role };
  }
}
