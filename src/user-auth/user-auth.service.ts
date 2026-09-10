import { BadRequestException, ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { User, WorkspaceType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { UpdateLanguageDto } from './dto/update-language.dto.js';
import { TokenBlacklistService } from './token-blacklist.service.js';

interface RefreshTokenPayload {
  sub: string;
  jti: string;
  exp: number;
}

@Injectable()
export class UserAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly tokenBlacklist: TokenBlacklistService,
    private readonly accountsService: AccountsService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const freePlan = await this.prisma.subscriptionPlan.findUnique({ where: { slug: 'free' } });

    // All-or-nothing: a user must never exist without their default
    // workspace (and vice versa) -- see Prompt 2 spec.
    const { user, defaultBusinessId } = await this.prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          name: dto.name,
          email: dto.email,
          phone: dto.phone,
          passwordHash,
          preferredLanguage: dto.preferredLanguage,
          // emailVerifiedAt stays null -- TODO: send a real verification
          // email once an email provider is wired up (not in scope yet).
        },
      });

      const defaultBusiness = await tx.business.create({
        data: {
          ownerId: createdUser.id,
          name: 'Personal',
          type: WorkspaceType.PERSONAL,
          isDefault: true,
          planId: freePlan?.id,
          members: { create: { userId: createdUser.id, role: 'OWNER' } },
        },
      });

      // Prompt 4: the default workspace should never exist without its
      // starter Chart of Accounts -- seeded in this same transaction, same
      // all-or-nothing reasoning as the user/workspace/membership rows above.
      await this.accountsService.seedDefaultAccounts(defaultBusiness.id, WorkspaceType.PERSONAL, tx);

      return { user: createdUser, defaultBusinessId: defaultBusiness.id };
    });

    const accessToken = this.signAccessToken(user);
    const refreshToken = this.signRefreshToken(user);

    return {
      accessToken,
      refreshToken,
      user: { id: user.id, name: user.name, email: user.email, preferredLanguage: user.preferredLanguage },
      defaultBusinessId,
    };
  }

  async login(dto: LoginDto, ipAddress?: string, userAgent?: string) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });

    // DELETED is treated the same as "no account" -- a soft-deleted account
    // shouldn't reveal its own existence any more than a nonexistent email
    // would. SUSPENDED gets a distinct, honest message (spec's explicit
    // completion criterion), since that's an account the owner should know
    // is theirs and be told how to resolve.
    if (!user || user.status === 'DELETED') {
      await this.recordLoginAttempt(dto.email, ipAddress, userAgent, false, 'account_not_found');
      throw new UnauthorizedException('Invalid email or password');
    }
    if (user.status === 'SUSPENDED') {
      await this.recordLoginAttempt(dto.email, ipAddress, userAgent, false, 'account_suspended');
      throw new ForbiddenException('Your account has been suspended. Contact support for assistance.');
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      await this.recordLoginAttempt(dto.email, ipAddress, userAgent, false, 'invalid_password');
      throw new UnauthorizedException('Invalid email or password');
    }

    const defaultBusiness = await this.prisma.business.findFirst({ where: { ownerId: user.id, isDefault: true } });

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
      this.prisma.loginAttempt.create({
        data: { email: dto.email, ipAddress: ipAddress ?? 'unknown', userAgent, success: true },
      }),
    ]);

    const accessToken = this.signAccessToken(user);
    const refreshToken = this.signRefreshToken(user);

    return {
      accessToken,
      refreshToken,
      user: { id: user.id, name: user.name, email: user.email, preferredLanguage: user.preferredLanguage },
      defaultBusinessId: defaultBusiness?.id ?? null,
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

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
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
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Account no longer exists');
    }

    // Prompt 3 introduced soft-deleted Business rows (deletedAt) and
    // MemberStatus -- both existed before this method ever filtered on them,
    // which meant a soft-deleted workspace, or a REMOVED membership, still
    // showed up here even though /api/businesses (Prompt 3) correctly
    // excludes them. Bug, not a deliberate difference -- fixed to match.
    const memberships = await this.prisma.businessMember.findMany({
      where: { userId, status: 'ACTIVE', business: { deletedAt: null } },
      include: { business: true },
    });

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      preferredLanguage: user.preferredLanguage,
      emailVerifiedAt: user.emailVerifiedAt,
      businesses: memberships.map((m) => ({
        id: m.business.id,
        name: m.business.name,
        type: m.business.type,
        role: m.role,
        isDefault: m.business.isDefault,
      })),
    };
  }

  async updateLanguage(userId: string, dto: UpdateLanguageDto) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { preferredLanguage: dto.preferredLanguage },
    });
    return { id: user.id, name: user.name, email: user.email, preferredLanguage: user.preferredLanguage };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Account no longer exists');
    }

    const currentMatches = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!currentMatches) {
      throw new BadRequestException('Current password is incorrect');
    }

    const newPasswordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: newPasswordHash } });
    return { success: true };
  }

  private signAccessToken(user: User): string {
    return this.jwtService.sign(
      { sub: user.id },
      {
        secret: this.configService.get<string>('USER_JWT_SECRET'),
        expiresIn: (this.configService.get<string>('USER_JWT_ACCESS_EXPIRES_IN') ?? '15m') as JwtSignOptions['expiresIn'],
      },
    );
  }

  private signRefreshToken(user: User): string {
    return this.jwtService.sign(
      { sub: user.id, jti: randomUUID() },
      {
        secret: this.configService.get<string>('USER_JWT_REFRESH_SECRET'),
        expiresIn: (this.configService.get<string>('USER_JWT_REFRESH_EXPIRES_IN') ?? '7d') as JwtSignOptions['expiresIn'],
      },
    );
  }

  private verifyRefreshToken(token: string): RefreshTokenPayload {
    try {
      return this.jwtService.verify<RefreshTokenPayload>(token, {
        secret: this.configService.get<string>('USER_JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }
}
