import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { User, WorkspaceType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { UpdateLanguageDto } from './dto/update-language.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { parseDeviceLabel } from './device-label.js';
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
    private readonly settingsService: SettingsService,
  ) {}

  async register(dto: RegisterDto, ipAddress?: string, userAgent?: string) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const freePlan = await this.prisma.subscriptionPlan.findUnique({ where: { slug: 'free' } });
    // Read once, outside the transaction below -- SettingsService.get()
    // uses the plain (non-transactional) PrismaService client, and calling
    // it from inside an open interactive transaction against `prisma dev`'s
    // single-connection pool starves that transaction until it hits its
    // 5s timeout (P2028). The reward amount is just a snapshot value; it
    // doesn't need transactional consistency with the user-creation below.
    const referralRewardAmount = (await this.settingsService.get()).referralRewardAmount;

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

      // Generate this user's own shareable referral code (same short-code
      // algorithm ReferralsService.generateUniqueReferralCode() uses for
      // backfilling pre-existing users -- duplicated here, not imported, to
      // avoid a circular UserAuthModule <-> ReferralsModule dependency; see
      // that method's own comment).
      let referralCode: string | undefined;
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = randomBytes(5).toString('hex').toUpperCase().slice(0, 8);
        const clash = await tx.user.findUnique({ where: { referralCode: candidate } });
        if (!clash) {
          referralCode = candidate;
          break;
        }
      }
      await tx.user.update({ where: { id: createdUser.id }, data: { referralCode } });

      // If this signup came through someone else's referral link, record it --
      // an unknown/stale code is silently ignored (registration must never fail
      // just because of a bad referral link).
      if (dto.referralCode) {
        const referrer = await tx.user.findUnique({ where: { referralCode: dto.referralCode } });
        if (referrer) {
          await tx.referral.create({
            data: { referrerId: referrer.id, referredUserId: createdUser.id, rewardAmount: referralRewardAmount, status: 'PENDING' },
          });
        }
      }

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

    const { accessToken, refreshToken } = await this.issueTokens(user, ipAddress, userAgent);

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

    const { accessToken, refreshToken } = await this.issueTokens(user, ipAddress, userAgent);

    return {
      accessToken,
      refreshToken,
      user: { id: user.id, name: user.name, email: user.email, preferredLanguage: user.preferredLanguage },
      defaultBusinessId: defaultBusiness?.id ?? null,
    };
  }

  // Shared by register()/login() -- signs both tokens off the SAME jti and
  // persists a UserSession row for it (Settings > Security's Device
  // Management), rather than each caller duplicating this.
  private async issueTokens(user: User, ipAddress: string | undefined, userAgent: string | undefined) {
    const jti = randomUUID();
    const accessToken = this.signAccessToken(user);
    const refreshToken = this.signRefreshToken(user, jti);
    await this.prisma.userSession.create({
      data: {
        userId: user.id,
        jti,
        deviceLabel: parseDeviceLabel(userAgent),
        ipAddress: ipAddress ?? 'unknown',
        userAgent,
      },
    });
    return { accessToken, refreshToken };
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

    // Persisted check, on top of the in-memory blacklist above -- a session
    // revoked from Settings > Security's Device Management (or from any
    // OTHER backend instance/after a restart) must stay rejected even
    // though the in-memory blacklist itself doesn't survive either of those.
    const session = await this.prisma.userSession.findUnique({ where: { jti: payload.jti } });
    if (session?.revokedAt) {
      throw new UnauthorizedException('This session has been signed out');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account no longer active');
    }

    if (session) {
      await this.prisma.userSession.update({ where: { jti: payload.jti }, data: { lastUsedAt: new Date() } });
    }

    return { accessToken: this.signAccessToken(user) };
  }

  async logout(refreshToken: string) {
    // Best-effort: an already-expired or malformed refresh token can't
    // meaningfully be revoked further, so don't fail the logout request over it.
    try {
      const payload = this.verifyRefreshToken(refreshToken);
      this.tokenBlacklist.revoke(payload.jti, payload.exp);
      await this.prisma.userSession.updateMany({ where: { jti: payload.jti, revokedAt: null }, data: { revokedAt: new Date() } });
    } catch {
      // ignore
    }
    return { success: true };
  }

  // Settings > Security > Device Management's "Devices" list -- every
  // still-active session (never revoked), most recently used first.
  // isCurrent is a best-effort match on THIS request's ip+userAgent, not a
  // cryptographic session identity -- the access token that authenticated
  // this call carries no jti (see signAccessToken()), only the refresh
  // token does, and the frontend never sends that back except to the
  // dedicated /refresh call. Good enough to highlight "this looks like the
  // device you're on right now" without overclaiming precision.
  async listSessions(userId: string, currentIp?: string, currentUserAgent?: string) {
    const sessions = await this.prisma.userSession.findMany({
      where: { userId, revokedAt: null },
      orderBy: { lastUsedAt: 'desc' },
    });
    return sessions.map((s) => ({
      id: s.id,
      deviceLabel: s.deviceLabel,
      ipAddress: s.ipAddress,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
      isCurrent: !!currentUserAgent && s.ipAddress === currentIp && s.userAgent === currentUserAgent,
    }));
  }

  // Ends one specific session -- blocks its refresh token from minting any
  // further access tokens (both the immediate in-memory blacklist and the
  // persisted revokedAt refresh() itself checks). Doesn't retroactively
  // invalidate an access token already issued to that device before this
  // call -- same real-world limitation every short-lived-access-token
  // system has; it simply expires within USER_JWT_ACCESS_EXPIRES_IN (15m
  // default) on its own.
  async revokeSession(userId: string, sessionId: string) {
    const session = await this.prisma.userSession.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId) {
      throw new NotFoundException('Session not found');
    }
    await this.prisma.userSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
    this.tokenBlacklist.revoke(session.jti);
    return { success: true };
  }

  // Settings > Security's "History" list -- every login attempt (success
  // AND failure) recorded against this account's email, most recent first.
  // Keyed by email rather than userId because LoginAttempt already records
  // attempts against emails that never resolve to a real user (see
  // login()'s account_not_found case) -- there's no userId to key by for
  // those, so this whole table has always been email-keyed, including the
  // rows that DO belong to a real account.
  async getLoginHistory(email: string) {
    const attempts = await this.prisma.loginAttempt.findMany({
      where: { email },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return attempts.map((a) => ({
      id: a.id,
      ipAddress: a.ipAddress,
      deviceLabel: parseDeviceLabel(a.userAgent),
      success: a.success,
      failureReason: a.failureReason,
      createdAt: a.createdAt,
    }));
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
      avatarUrl: user.avatarUrl,
      preferredLanguage: user.preferredLanguage,
      emailVerifiedAt: user.emailVerifiedAt,
      businesses: memberships.map((m) => ({
        id: m.business.id,
        name: m.business.name,
        type: m.business.type,
        // Added Prompt 7 -- every money-displaying page (accounts list,
        // account detail, reports) needs the active workspace's currency
        // for formatCurrency(); this avoids an extra per-page fetch of
        // BusinessDetail just to read one field.
        currency: m.business.currency,
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

  // Settings > Profile page's "Save Changes" -- name/phone only (email is
  // shown read-only there, changing it is a bigger, separate re-
  // verification flow this app doesn't have yet).
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.phone !== undefined && { phone: dto.phone || null }),
      },
    });
    return { id: user.id, name: user.name, email: user.email, phone: user.phone, avatarUrl: user.avatarUrl };
  }

  async updateAvatar(userId: string, avatarUrl: string) {
    const user = await this.prisma.user.update({ where: { id: userId }, data: { avatarUrl } });
    return { id: user.id, avatarUrl: user.avatarUrl };
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

  // jti is passed in (generated by issueTokens()) rather than randomUUID()'d
  // here, so the SAME id backs both this token's own claim and its
  // UserSession row -- one session per issued refresh token.
  private signRefreshToken(user: User, jti: string): string {
    return this.jwtService.sign(
      { sub: user.id, jti },
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
