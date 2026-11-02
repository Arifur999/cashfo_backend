import { Injectable, NotFoundException } from '@nestjs/common';
import { Role, UserStatus } from '@prisma/client';
import { ensureReferralCode } from '../common/referral-code.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';

// What the public card shows: who it is and the invite. Never the email,
// phone or address.
export interface PublicProfileCard {
  code: string;
  name: string;
  avatarUrl: string | null;
  coverUrl: string | null;
  memberSince: Date;
  friendDiscountPct: number;
}

const CODE = /^[A-Z0-9]{4,16}$/;

const notFound = () => new NotFoundException({ statusCode: 404, error: 'Not Found', message: 'This profile card is not shared.', reason: 'CARD_NOT_SHARED' });

// Settings > Profile > Share profile card: a public page (/card/<code>) with
// the person's name, photo and cover, and an invite that signs a friend up
// with their referral code. Off until they turn it on, and turning it off
// takes the page down at once.
@Injectable()
export class ProfileCardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async setShared(userId: string, shared: boolean): Promise<{ shared: boolean; code: string | null }> {
    if (!shared) {
      await this.prisma.user.update({ where: { id: userId }, data: { profileCardSharedAt: null } });
      const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { referralCode: true } });
      return { shared: false, code: user.referralCode };
    }
    const code = await ensureReferralCode(this.prisma, userId);
    // Kept when already on, so the date says when sharing began.
    await this.prisma.user.updateMany({ where: { id: userId, profileCardSharedAt: null }, data: { profileCardSharedAt: new Date() } });
    return { shared: true, code };
  }

  // GET /api/profile-card/:code, no sign-in: only a card its owner shares,
  // and only an active customer's.
  async card(rawCode: string): Promise<PublicProfileCard> {
    const code = rawCode.trim().toUpperCase();
    if (!CODE.test(code)) throw notFound();
    const user = await this.prisma.user.findUnique({
      where: { referralCode: code },
      select: { name: true, avatarUrl: true, coverUrl: true, createdAt: true, role: true, status: true, profileCardSharedAt: true },
    });
    if (!user || !user.profileCardSharedAt || user.role !== Role.USER || user.status !== UserStatus.ACTIVE) throw notFound();
    const { programLive, friendDiscountPct } = await this.settings.getReferralSettings();
    return { code, name: user.name, avatarUrl: user.avatarUrl, coverUrl: user.coverUrl, memberSince: user.createdAt, friendDiscountPct: programLive ? friendDiscountPct : 0 };
  }
}
