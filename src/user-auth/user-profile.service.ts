import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { User } from '@prisma/client';
import { CredentialsService } from '../auth/credentials.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpdateLanguageDto } from './dto/update-language.dto.js';
import { UpdatePreferencesDto } from './dto/update-preferences.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { canonicalPhone } from './phone.service.js';

const preferencesOf = (user: Pick<User, 'digitStyle' | 'numberGrouping' | 'dateStyle' | 'weekStart'>) => ({
  digitStyle: user.digitStyle,
  numberGrouping: user.numberGrouping,
  dateStyle: user.dateStyle,
  weekStart: user.weekStart,
});

// The signed-in user's own account details: the /me payload with their
// workspaces, and the profile fields Settings lets them change.
@Injectable()
export class UserProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialsService,
  ) {}

  // impersonatedBy: the admin behind a read-only "View as customer"
  // session, named so the app can say whose view it is.
  async me(userId: string, impersonatedBy?: string) {
    const [user, admin] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      impersonatedBy ? this.prisma.user.findUnique({ where: { id: impersonatedBy }, select: { name: true, email: true } }) : null,
    ]);
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
      phoneVerifiedAt: user.phoneVerifiedAt,
      avatarUrl: user.avatarUrl,
      preferredLanguage: user.preferredLanguage,
      emailVerifiedAt: user.emailVerifiedAt,
      emailVerified: user.emailVerified,
      passwordChangedAt: user.passwordChangedAt,
      // "Member since" (Settings > Profile).
      createdAt: user.createdAt,
      // Settings > App > Numbers and dates; the app formats every amount and
      // date with these (digitStyle null = follow the language).
      preferences: preferencesOf(user),
      // Settings > Security > Alerts, and the monthly summary email
      // (Settings > App > Reminders). Sent once email is set up.
      alerts: { alertNewDevice: user.alertNewDevice, alertFailedTries: user.alertFailedTries, askCodeBeforeReset: user.askCodeBeforeReset },
      monthlySummaryEmail: user.monthlySummaryEmail,
      // False for a Google-only account: Settings offers to set a password
      // instead of changing one.
      hasPassword: await this.credentials.has(user.id),
      // Two-step sign-in with an authenticator app (Settings > Security).
      twoFactorEnabled: Boolean((await this.prisma.twoFactor.findUnique({ where: { userId: user.id }, select: { enabledAt: true } }))?.enabledAt),
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
        hasPinLock: m.business.pinHash !== null,
        trialEndsAt: m.business.trialEndsAt,
      })),
      impersonatedBy: impersonatedBy ? { name: admin?.name ?? 'An admin', email: admin?.email ?? null } : null,
    };
  }

  // Settings > App > Numbers and dates. Only the fields sent change; a null
  // digitStyle goes back to following the language.
  async updatePreferences(userId: string, dto: UpdatePreferencesDto) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.digitStyle !== undefined && { digitStyle: dto.digitStyle }),
        ...(dto.numberGrouping !== undefined && { numberGrouping: dto.numberGrouping }),
        ...(dto.dateStyle !== undefined && { dateStyle: dto.dateStyle }),
        ...(dto.weekStart !== undefined && { weekStart: dto.weekStart }),
      },
      select: { digitStyle: true, numberGrouping: true, dateStyle: true, weekStart: true },
    });
    return preferencesOf(user);
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
  // A new number loses the verification (PhoneService); the same verified
  // number typed another way keeps it.
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const current = dto.phone !== undefined ? await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { phone: true, phoneVerifiedAt: true } }) : null;
    const keepsVerified = !!current?.phoneVerifiedAt && !!dto.phone && canonicalPhone(dto.phone) === current.phone;
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.phone !== undefined && !keepsVerified && { phone: dto.phone || null, phoneVerifiedAt: null }),
      },
    });
    return { id: user.id, name: user.name, email: user.email, phone: user.phone, phoneVerifiedAt: user.phoneVerifiedAt, avatarUrl: user.avatarUrl };
  }

  async updateAvatar(userId: string, avatarUrl: string | null) {
    const user = await this.prisma.user.update({ where: { id: userId }, data: { avatarUrl } });
    return { id: user.id, avatarUrl: user.avatarUrl };
  }
}
