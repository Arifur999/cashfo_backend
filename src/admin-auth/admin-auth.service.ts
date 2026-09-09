import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { AdminUser } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { LoginDto } from './dto/login.dto.js';
import { TokenBlacklistService } from './token-blacklist.service.js';

interface RefreshTokenPayload {
  sub: string;
  jti: string;
  exp: number;
}

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly tokenBlacklist: TokenBlacklistService,
  ) {}

  async login(dto: LoginDto, ipAddress?: string) {
    const admin = await this.prisma.adminUser.findUnique({ where: { email: dto.email } });
    if (!admin) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (admin.status !== 'ACTIVE') {
      throw new UnauthorizedException('This account has been suspended');
    }

    const passwordMatches = await bcrypt.compare(dto.password, admin.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const accessToken = this.signAccessToken(admin);
    const refreshToken = this.signRefreshToken(admin);

    await this.prisma.$transaction([
      this.prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } }),
      this.prisma.auditLog.create({
        data: {
          adminUserId: admin.id,
          action: 'ADMIN_LOGIN',
          entityType: 'AdminUser',
          entityId: admin.id,
          ipAddress,
        },
      }),
    ]);

    return {
      accessToken,
      refreshToken,
      adminUser: { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
    };
  }

  async refresh(refreshToken: string) {
    const payload = this.verifyRefreshToken(refreshToken);

    if (this.tokenBlacklist.isRevoked(payload.jti)) {
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    const admin = await this.prisma.adminUser.findUnique({ where: { id: payload.sub } });
    if (!admin || admin.status !== 'ACTIVE') {
      throw new UnauthorizedException('Admin no longer active');
    }

    return { accessToken: this.signAccessToken(admin) };
  }

  async logout(refreshToken: string) {
    // Best-effort: an already-expired or malformed refresh token can't
    // meaningfully be revoked further, so don't fail the logout request over it.
    try {
      const payload = this.verifyRefreshToken(refreshToken);
      this.tokenBlacklist.revoke(payload.jti, payload.exp);
    } catch {
      // ignore
    }
    return { success: true };
  }

  async me(adminId: string) {
    const admin = await this.prisma.adminUser.findUnique({ where: { id: adminId } });
    if (!admin) {
      throw new UnauthorizedException('Admin no longer exists');
    }
    return { id: admin.id, name: admin.name, email: admin.email, role: admin.role };
  }

  private signAccessToken(admin: AdminUser): string {
    return this.jwtService.sign(
      { sub: admin.id, role: admin.role },
      {
        secret: this.configService.get<string>('JWT_SECRET'),
        // Cast: env vars are plain strings, but jsonwebtoken's `expiresIn`
        // type is a branded `StringValue` (from the `ms` package) rather than
        // `string` -- the runtime happily parses "15m"/"7d", only the type
        // needs the nudge.
        expiresIn: (this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m') as JwtSignOptions['expiresIn'],
      },
    );
  }

  private signRefreshToken(admin: AdminUser): string {
    return this.jwtService.sign(
      { sub: admin.id, jti: randomUUID() },
      {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: (this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d') as JwtSignOptions['expiresIn'],
      },
    );
  }

  private verifyRefreshToken(token: string): RefreshTokenPayload {
    try {
      return this.jwtService.verify<RefreshTokenPayload>(token, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }
}
