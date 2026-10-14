import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpdateLanguageDto } from './dto/update-language.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';

// The signed-in user's own account details: the /me payload with their
// workspaces, and the profile fields Settings lets them change.
@Injectable()
export class UserProfileService {
  constructor(private readonly prisma: PrismaService) {}

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
        hasPinLock: m.business.pinHash !== null,
        trialEndsAt: m.business.trialEndsAt,
      })),
      impersonatedBy: impersonatedBy ? { name: admin?.name ?? 'An admin', email: admin?.email ?? null } : null,
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
}
