import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { PlatformUser } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { TokenBlacklistService } from './token-blacklist.service.js';

interface RefreshTokenPayload {
  sub: string;
  jti: string;
  exp: number;
}

@Injectable()
export class PlatformAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly tokenBlacklist: TokenBlacklistService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.platformUser.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    // New signups default onto the "free" plan when one exists; falls back to
    // no plan (null) rather than failing signup if it's ever missing/renamed.
    const freePlan = await this.prisma.subscriptionPlan.findUnique({ where: { slug: 'free' } });

    const user = await this.prisma.platformUser.create({
      data: {
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        passwordHash,
        planId: freePlan?.id,
        signupSource: 'web',
      },
    });

    const accessToken = this.signAccessToken(user);
    const refreshToken = this.signRefreshToken(user);

    return {
      accessToken,
      refreshToken,
      user: { id: user.id, name: user.name, email: user.email },
    };
  }

  async login(dto: LoginDto, ipAddress?: string, userAgent?: string) {
    const user = await this.prisma.platformUser.findUnique({ where: { email: dto.email } });

    if (!user || !user.passwordHash) {
      await this.recordLoginAttempt(dto.email, ipAddress, userAgent, false, 'account_not_found');
      throw new UnauthorizedException('Invalid email or password');
    }
    if (user.status !== 'ACTIVE') {
      await this.recordLoginAttempt(dto.email, ipAddress, userAgent, false, 'account_suspended');
      throw new UnauthorizedException('This account is not active');
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      await this.recordLoginAttempt(dto.email, ipAddress, userAgent, false, 'invalid_password');
      throw new UnauthorizedException('Invalid email or password');
    }

    const accessToken = this.signAccessToken(user);
    const refreshToken = this.signRefreshToken(user);

    await this.prisma.$transaction([
      this.prisma.platformUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
      this.prisma.loginAttempt.create({
        data: { email: dto.email, ipAddress: ipAddress ?? 'unknown', userAgent, success: true },
      }),
    ]);

    return {
      accessToken,
      refreshToken,
      user: { id: user.id, name: user.name, email: user.email },
    };
  }

  private async recordLoginAttempt(email: string, ipAddress: string | undefined, userAgent: string | undefined, success: boolean, failureReason: string) {
    await this.prisma.loginAttempt.create({
      data: { email, ipAddress: ipAddress ?? 'unknown', userAgent, success, failureReason },
    });
  }

  async refresh(refreshToken: string) {
    const payload = this.verifyRefreshToken(refreshToken);

    if (this.tokenBlacklist.isRevoked(payload.jti)) {
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    const user = await this.prisma.platformUser.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account no longer active');
    }

    return { accessToken: this.signAccessToken(user) };
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

  async me(userId: string) {
    const user = await this.prisma.platformUser.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Account no longer exists');
    }
    return { id: user.id, name: user.name, email: user.email };
  }

  private signAccessToken(user: PlatformUser): string {
    return this.jwtService.sign(
      { sub: user.id },
      {
        secret: this.configService.get<string>('PLATFORM_JWT_SECRET'),
        expiresIn: (this.configService.get<string>('PLATFORM_JWT_ACCESS_EXPIRES_IN') ?? '15m') as JwtSignOptions['expiresIn'],
      },
    );
  }

  private signRefreshToken(user: PlatformUser): string {
    return this.jwtService.sign(
      { sub: user.id, jti: randomUUID() },
      {
        secret: this.configService.get<string>('PLATFORM_JWT_REFRESH_SECRET'),
        expiresIn: (this.configService.get<string>('PLATFORM_JWT_REFRESH_EXPIRES_IN') ?? '7d') as JwtSignOptions['expiresIn'],
      },
    );
  }

  private verifyRefreshToken(token: string): RefreshTokenPayload {
    try {
      return this.jwtService.verify<RefreshTokenPayload>(token, {
        secret: this.configService.get<string>('PLATFORM_JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }
}
