import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { fromPaisa, toPaisa } from '../billing/pricing.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateReferralLinkDto, UpdateReferralLinkDto } from './dto/referral-links.dto.js';
import { EARNED_STATUSES, payingFriendWhere } from './referral-friends.js';

type Client = PrismaService | Prisma.TransactionClient;

// The main link has no tag (no &src= on the link).
export const MAIN_TAG = '';
export const MAX_LINKS = 20;
const MAIN_LABEL = 'Main link';

// Referrals > Invite links: one code, many places. Each link counts its
// opens; sign-ups, paying friends and earnings come from the friends who
// signed up through it (a friend with no link came through the main one).
@Injectable()
export class ReferralLinksService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const main = await this.ensureMain(this.prisma, userId);
    const links = await this.prisma.referralLink.findMany({ where: { userId, deletedAt: null }, orderBy: { createdAt: 'asc' } });
    const linkOf = (linkId: string | null) => linkId ?? main.id;
    const [joined, paying, earned] = await Promise.all([
      this.prisma.referral.groupBy({ by: ['linkId'], where: { referrerId: userId }, _count: { _all: true } }),
      this.prisma.referral.groupBy({ by: ['linkId'], where: { referrerId: userId, ...payingFriendWhere() }, _count: { _all: true } }),
      this.prisma.referralCommission.findMany({
        where: { referrerId: userId, status: { in: [...EARNED_STATUSES] } },
        select: { amount: true, referral: { select: { linkId: true } } },
      }),
    ]);
    const add = (map: Map<string, number>, key: string, value: number) => map.set(key, (map.get(key) ?? 0) + value);
    const joinedBy = new Map<string, number>();
    const payingBy = new Map<string, number>();
    const earnedBy = new Map<string, number>();
    for (const g of joined) add(joinedBy, linkOf(g.linkId), g._count._all);
    for (const g of paying) add(payingBy, linkOf(g.linkId), g._count._all);
    for (const c of earned) add(earnedBy, linkOf(c.referral.linkId), toPaisa(c.amount));
    return links
      .sort((a, b) => Number(b.tag === MAIN_TAG) - Number(a.tag === MAIN_TAG))
      .map((link) => ({
        id: link.id,
        label: link.tag === MAIN_TAG ? MAIN_LABEL : link.label,
        tag: link.tag,
        main: link.tag === MAIN_TAG,
        clicks: link.clicks,
        joined: joinedBy.get(link.id) ?? 0,
        paying: payingBy.get(link.id) ?? 0,
        earned: fromPaisa(earnedBy.get(link.id) ?? 0),
        createdAt: link.createdAt,
      }));
  }

  // A tag used before and deleted comes back with the new name.
  async create(userId: string, dto: CreateReferralLinkDto) {
    await this.ensureMain(this.prisma, userId);
    const existing = await this.prisma.referralLink.findUnique({ where: { userId_tag: { userId, tag: dto.tag } } });
    if (existing && !existing.deletedAt) throw new ConflictException('You already have a link with this tag');
    const live = await this.prisma.referralLink.count({ where: { userId, deletedAt: null } });
    if (live >= MAX_LINKS) throw new ConflictException(`You can have up to ${MAX_LINKS} links. Delete one you no longer use.`);
    if (existing) await this.prisma.referralLink.update({ where: { id: existing.id }, data: { label: dto.label, deletedAt: null } });
    else await this.prisma.referralLink.create({ data: { userId, label: dto.label, tag: dto.tag } });
    return this.list(userId);
  }

  async rename(userId: string, id: string, dto: UpdateReferralLinkDto) {
    const { count } = await this.prisma.referralLink.updateMany({ where: { id, userId, deletedAt: null, tag: { not: MAIN_TAG } }, data: { label: dto.label } });
    if (count === 0) throw new NotFoundException('Link not found');
    return this.list(userId);
  }

  // The friends who came through it keep its name ("Came from").
  async remove(userId: string, id: string) {
    const { count } = await this.prisma.referralLink.updateMany({
      where: { id, userId, deletedAt: null, tag: { not: MAIN_TAG } },
      data: { deletedAt: new Date() },
    });
    if (count === 0) throw new NotFoundException('Link not found');
    return this.list(userId);
  }

  // An open of someone's invite link (the sign-up page, once per visitor
  // session). An unknown code or tag is ignored.
  async click(code: string, src: string | undefined) {
    const owner = await this.prisma.user.findUnique({ where: { referralCode: code.trim().toUpperCase() }, select: { id: true, role: true, status: true } });
    if (!owner || owner.role !== 'USER' || owner.status !== 'ACTIVE') return;
    const tag = src ?? MAIN_TAG;
    if (tag === MAIN_TAG) await this.ensureMain(this.prisma, owner.id);
    await this.prisma.referralLink.updateMany({ where: { userId: owner.id, tag, deletedAt: null }, data: { clicks: { increment: 1 } } });
  }

  // Made on first use; two first uses at once make it once.
  private async ensureMain(client: Client, userId: string) {
    await client.referralLink.createMany({ data: [{ userId, tag: MAIN_TAG, label: MAIN_LABEL }], skipDuplicates: true });
    return client.referralLink.findUniqueOrThrow({ where: { userId_tag: { userId, tag: MAIN_TAG } } });
  }
}

// The link a sign-up came through, by its tag; null for the main link or a
// tag that isn't (or no longer is) one of the referrer's links.
export async function referralLinkFor(client: Client, referrerId: string, src: string | undefined): Promise<string | null> {
  if (!src) return null;
  const link = await client.referralLink.findUnique({ where: { userId_tag: { userId: referrerId, tag: src } }, select: { id: true, deletedAt: true } });
  return link && !link.deletedAt ? link.id : null;
}
