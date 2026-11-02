import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BillingCycle, type Prisma } from '@prisma/client';
import { isPaidStatus } from '../billing/periods.js';
import { fromPaisa, toPaisa } from '../billing/pricing.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import type { FriendsQueryDto } from './dto/referral-pages.dto.js';
import { EARNED_STATUSES, FRIEND_STANDINGS, standingWhere } from './referral-friends.js';
import { MAIN_TAG } from './referral-links.service.js';
import { displayPayoutId, isoWeekKey } from './referral-money.js';
import { ReferralNotices } from './referral-notices.js';
import { friendStanding, isBlockedSignup } from './referral-rules.js';

const FRIEND_SELECT = {
  id: true,
  createdAt: true,
  status: true,
  cancelReason: true,
  link: { select: { id: true, label: true, tag: true } },
  referredUser: {
    select: {
      id: true,
      name: true,
      subscription: { select: { status: true, currentPeriodEnd: true, cancelAtPeriodEnd: true, plan: { select: { name: true, billingCycle: true } } } },
    },
  },
} as const satisfies Prisma.ReferralSelect;

type FriendRow = Prisma.ReferralGetPayload<{ select: typeof FRIEND_SELECT }>;
type LineSums = { paidPaisa: number; earnedPaisa: number };

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

// Referrals > Referred users: everyone who signed up with the member's
// links, how they stand (paying, free, stopped, refunded), what they paid
// and what that earned the member. Friends see only first names and plans
// here: never a friend's email or phone.
@Injectable()
export class ReferralFriendsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly notices: ReferralNotices,
  ) {}

  async list(userId: string, query: FriendsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const base: Prisma.ReferralWhereInput = {
      referrerId: userId,
      ...(query.search && { referredUser: { name: { contains: query.search, mode: 'insensitive' } } }),
    };
    const where: Prisma.ReferralWhereInput = query.standing ? { AND: [base, standingWhere(query.standing)] } : base;
    const [rows, total, ...counts] = await Promise.all([
      this.prisma.referral.findMany({ where, select: FRIEND_SELECT, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.referral.count({ where }),
      ...FRIEND_STANDINGS.map((standing) => this.prisma.referral.count({ where: { AND: [base, standingWhere(standing)] } })),
    ]);
    const views = await this.views(rows);
    return {
      data: views,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      counts: { ALL: counts.reduce((a, b) => a + b, 0), ...Object.fromEntries(FRIEND_STANDINGS.map((standing, i) => [standing, counts[i]])) },
    };
  }

  // One friend with every payment and the member's share of it.
  async detail(userId: string, referralId: string) {
    const row = await this.prisma.referral.findFirst({ where: { id: referralId, referrerId: userId }, select: FRIEND_SELECT });
    if (!row) throw new NotFoundException('Friend not found');
    const [[view], lines] = await Promise.all([
      this.views([row]),
      this.prisma.referralCommission.findMany({
        where: { referralId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          kind: true,
          status: true,
          paidAmount: true,
          amount: true,
          availableAt: true,
          createdAt: true,
          payment: { select: { paidAt: true, plan: { select: { name: true } } } },
          payout: { select: { number: true } },
        },
      }),
    ]);
    return {
      ...view,
      payments: lines.map((line) => ({
        id: line.id,
        paidAt: line.payment?.paidAt ?? line.createdAt,
        planName: line.payment?.plan.name ?? null,
        kind: line.kind,
        paidAmount: fromPaisa(toPaisa(line.paidAmount)),
        amount: fromPaisa(toPaisa(line.amount)),
        status: line.status,
        availableAt: line.availableAt,
        payoutDisplayId: line.payout ? displayPayoutId(line.payout.number) : null,
      })),
    };
  }

  // "Send a reminder" to friends who joined but haven't bought: a row in
  // their bell, at most once a week each.
  async remind(userId: string, referralIds: string[]) {
    const settings = await this.settingsService.getReferralSettings();
    if (!settings.programLive) throw new BadRequestException('The Referral Program is paused');
    const [me, rows] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, referralName: true } }),
      this.prisma.referral.findMany({
        where: { AND: [{ id: { in: referralIds }, referrerId: userId }, standingWhere('FREE')] },
        select: { id: true, referredUserId: true },
      }),
    ]);
    const week = isoWeekKey(new Date());
    let sent = 0;
    for (const row of rows) {
      const fresh = await this.notices.bell(row.referredUserId, 'REFERRAL', `referral-nudge:${row.id}:${week}`, {
        event: 'INVITE_REMINDER',
        referrerFirstName: me.referralName ?? firstName(me.name),
        friendDiscountPct: settings.friendDiscountPct,
      });
      if (fresh) sent++;
    }
    return { sent, skipped: referralIds.length - sent };
  }

  private async views(rows: FriendRow[]) {
    const referralIds = rows.map((r) => r.id);
    const friendIds = rows.map((r) => r.referredUser.id);
    const [lines, payments] = await Promise.all([
      referralIds.length
        ? this.prisma.referralCommission.findMany({
            where: { referralId: { in: referralIds } },
            select: { referralId: true, kind: true, status: true, paidAmount: true, amount: true },
          })
        : [],
      friendIds.length
        ? this.prisma.payment.groupBy({
            by: ['userId', 'status'],
            where: { userId: { in: friendIds }, status: { in: ['SUCCESS', 'REFUNDED'] } },
            _count: { _all: true },
          })
        : [],
    ]);
    const sums = new Map<string, LineSums>();
    for (const line of lines) {
      const sum = sums.get(line.referralId) ?? { paidPaisa: 0, earnedPaisa: 0 };
      if (line.kind !== 'BONUS' && line.status !== 'REVERSED') sum.paidPaisa += toPaisa(line.paidAmount);
      if ((EARNED_STATUSES as readonly string[]).includes(line.status)) sum.earnedPaisa += toPaisa(line.amount);
      sums.set(line.referralId, sum);
    }
    const paymentCount = (friendId: string, status: 'SUCCESS' | 'REFUNDED') =>
      payments.find((p) => p.userId === friendId && p.status === status)?._count._all ?? 0;

    return rows.map((row) => {
      const sub = row.referredUser.subscription;
      const onPaidPlan = sub ? isPaidStatus(sub.status, sub.plan.billingCycle !== BillingCycle.FREE) : false;
      const standing = friendStanding({
        blocked: isBlockedSignup(row),
        onPaidPlan,
        paidCount: paymentCount(row.referredUser.id, 'SUCCESS'),
        refundedCount: paymentCount(row.referredUser.id, 'REFUNDED'),
      });
      const sum = sums.get(row.id) ?? { paidPaisa: 0, earnedPaisa: 0 };
      return {
        id: row.id,
        name: row.referredUser.name,
        joinedAt: row.createdAt,
        // The invite link they came through ("Came from"); null = main link.
        link: row.link && row.link.tag !== MAIN_TAG ? { id: row.link.id, label: row.link.label, tag: row.link.tag } : null,
        standing,
        blockedReason: standing === 'BLOCKED' ? row.cancelReason : null,
        planName: onPaidPlan && sub ? sub.plan.name : null,
        // Their next payment, while the plan renews.
        nextPaymentAt: onPaidPlan && sub && !sub.cancelAtPeriodEnd ? sub.currentPeriodEnd : null,
        paid: fromPaisa(sum.paidPaisa),
        earned: fromPaisa(sum.earnedPaisa),
        canRemind: standing === 'FREE',
      };
    });
  }
}
