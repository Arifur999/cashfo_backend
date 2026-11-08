import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { User } from '@prisma/client';
import { CredentialsService } from '../auth/credentials.service.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpdateLanguageDto } from './dto/update-language.dto.js';
import { UpdatePreferencesDto } from './dto/update-preferences.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { canonicalPhone } from './phone.service.js';
import { customerCode } from '../common/districts.js';
import { dhakaDateKey } from '../common/dhaka.js';
import { profileDetailsProblem } from './profile-rules.js';

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
    private readonly mail: MailService,
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
      coverUrl: user.coverUrl,
      address: user.address,
      // Settings › Profile's details, and the number support asks for.
      occupation: user.occupation,
      dateOfBirth: user.dateOfBirth ? user.dateOfBirth.toISOString().slice(0, 10) : null,
      gender: user.gender,
      district: user.district,
      phone2: user.phone2,
      phone2WhatsApp: user.phone2WhatsApp,
      // Settings › Security › Recovery email (proved with a code).
      recoveryEmail: user.recoveryEmail,
      customerCode: customerCode(user.customerNumber),
      // Whether the shareable profile card is on, and its code (the
      // referral code), for Settings > Profile.
      profileCard: { shared: user.profileCardSharedAt !== null, code: user.referralCode },
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
      // Whether the platform can send email at all: without it the app hides
      // what only an email can do ("Send a verification email").
      emailReady: this.mail.configured,
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
    const touchesPhones = dto.phone !== undefined || dto.phone2 !== undefined || dto.phone2WhatsApp !== undefined;
    const current = touchesPhones ? await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { phone: true, phoneVerifiedAt: true, phone2: true } }) : null;
    const keepsVerified = !!current?.phoneVerifiedAt && !!dto.phone && canonicalPhone(dto.phone) === current.phone;
    // The second number: a real mobile, not the main one again.
    const phone2 = dto.phone2 === undefined ? undefined : dto.phone2 === '' ? null : canonicalPhone(dto.phone2);
    const mainAfter = dto.phone === undefined ? (current?.phone ?? null) : dto.phone ? canonicalPhone(dto.phone) : null;
    const problem = profileDetailsProblem({ dateOfBirth: dto.dateOfBirth, phone2Typed: dto.phone2, phone2, mainPhone: mainAfter }, dhakaDateKey(new Date()));
    if (problem) throw new BadRequestException(problem);
    const phone2After = phone2 === undefined ? (current?.phone2 ?? null) : phone2;
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.phone !== undefined && !keepsVerified && { phone: dto.phone || null, phoneVerifiedAt: null }),
        ...(dto.address !== undefined && { address: dto.address || null }),
        ...(dto.occupation !== undefined && { occupation: dto.occupation || null }),
        ...(dto.dateOfBirth !== undefined && { dateOfBirth: dto.dateOfBirth ? new Date(`${dto.dateOfBirth}T00:00:00.000Z`) : null }),
        ...(dto.gender !== undefined && { gender: dto.gender || null }),
        ...(dto.district !== undefined && { district: dto.district || null }),
        ...(phone2 !== undefined && { phone2 }),
        // WhatsApp goes with the second number: none, no WhatsApp.
        ...((dto.phone2WhatsApp !== undefined || phone2 !== undefined) && { phone2WhatsApp: Boolean(phone2After) && (dto.phone2WhatsApp ?? false) }),
      },
    });
    return { id: user.id, name: user.name, email: user.email, phone: user.phone, phoneVerifiedAt: user.phoneVerifiedAt, avatarUrl: user.avatarUrl, address: user.address };
  }

  async updateAvatar(userId: string, avatarUrl: string | null) {
    const user = await this.prisma.user.update({ where: { id: userId }, data: { avatarUrl } });
    return { id: user.id, avatarUrl: user.avatarUrl };
  }

  // The wide photo over the profile; null goes back to the gradient.
  async updateCover(userId: string, coverUrl: string | null) {
    const user = await this.prisma.user.update({ where: { id: userId }, data: { coverUrl } });
    return { id: user.id, coverUrl: user.coverUrl };
  }
}
