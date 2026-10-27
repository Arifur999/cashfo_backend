import { Injectable } from '@nestjs/common';
import { FlagStatus, TicketStatus } from '@prisma/client';
import { REAL_FAILURE_WHERE } from '../billing/payment-reasons.js';
import type { RequestAdminUser } from '../admin-auth/interfaces/request-admin-user.interface.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PAUSE_MS, pausedNetworks } from '../security/security-extras.js';
import { arrangeFeed, feedGroupsFor, mostCommon, type FeedItem } from './admin-feed.js';
import { payerIdOf, requesterNames } from './requester-names.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// A customer's message counts as waiting once it has had no answer this long.
const WAITING_AFTER_MS = 2 * HOUR_MS;
const PER_SOURCE = 10;

// The admin bell. Nothing is stored but each admin's "Mark all as read"
// time: the rows are read live from what needs a hand -- failed payments,
// tickets waiting on an answer, security flags, paused sign-ins and the
// day's errors -- and only the groups the admin's role can act on.
@Injectable()
export class AdminFeedService {
  constructor(private readonly prisma: PrismaService) {}

  async feed(admin: RequestAdminUser) {
    const groups = feedGroupsFor(admin.role);
    const now = Date.now();
    const [me, money, support, system] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: admin.id }, select: { adminFeedSeenAt: true } }),
      groups.includes('MONEY') ? this.moneyItems(now) : [],
      groups.includes('SUPPORT') ? this.waitingTickets(now) : [],
      groups.includes('SYSTEM') ? this.systemItems(now) : [],
    ]);
    return { groups, ...arrangeFeed([...money, ...support, ...system], me?.adminFeedSeenAt ?? null) };
  }

  async markSeen(adminId: string) {
    const { adminFeedSeenAt } = await this.prisma.user.update({ where: { id: adminId }, data: { adminFeedSeenAt: new Date() }, select: { adminFeedSeenAt: true } });
    return { seenAt: adminFeedSeenAt };
  }

  // Failed payments of the last week, and customers' checkouts waiting for
  // an admin's Mark paid.
  private async moneyItems(now: number): Promise<FeedItem[]> {
    const select = { id: true, userId: true, platformUserId: true, amount: true, gateway: true, failureReason: true, createdAt: true, plan: { select: { name: true } } } as const;
    const [failed, pending] = await Promise.all([
      // A checkout the customer replaced or cancelled, or one that lapsed,
      // is not a failure anyone needs to look at.
      this.prisma.payment.findMany({
        where: { status: 'FAILED', createdAt: { gte: new Date(now - 7 * DAY_MS) }, ...REAL_FAILURE_WHERE },
        orderBy: { createdAt: 'desc' },
        take: PER_SOURCE,
        select,
      }),
      this.prisma.payment.findMany({
        where: { status: 'PENDING', userId: { not: null }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date(now) } }] },
        orderBy: { createdAt: 'desc' },
        take: PER_SOURCE,
        select,
      }),
    ]);
    const names = await requesterNames(this.prisma, [...failed, ...pending].map(payerIdOf));
    const nameOf = (row: (typeof failed)[number]) => {
      const payer = payerIdOf(row);
      return payer ? (names.get(payer) ?? null) : null;
    };
    return [
      ...failed.map((row): FeedItem => ({
        id: `payment:${row.id}`,
        group: 'MONEY',
        kind: 'PAYMENT_FAILED',
        data: { name: nameOf(row), plan: row.plan.name, gateway: row.gateway, reason: row.failureReason, amount: row.amount.toFixed(2) },
        at: row.createdAt,
        href: `/admin/payments/${row.id}`,
      })),
      ...pending.map((row): FeedItem => ({
        id: `payment-pending:${row.id}`,
        group: 'MONEY',
        kind: 'PAYMENT_PENDING',
        data: { name: nameOf(row), plan: row.plan.name, gateway: row.gateway, amount: row.amount.toFixed(2), paymentId: row.id },
        at: row.createdAt,
        href: `/admin/payments/${row.id}`,
      })),
    ];
  }

  // Open tickets whose last word is the customer's, unanswered for a while.
  private async waitingTickets(now: number): Promise<FeedItem[]> {
    const tickets = await this.prisma.supportTicket.findMany({
      where: { status: { in: [TicketStatus.OPEN, TicketStatus.IN_PROGRESS] } },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: { id: true, subject: true, category: true, messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { senderType: true, createdAt: true } } },
    });
    return tickets
      .filter((ticket) => ticket.messages[0]?.senderType === 'USER' && ticket.messages[0].createdAt.getTime() <= now - WAITING_AFTER_MS)
      .slice(0, PER_SOURCE)
      .map((ticket) => ({
        id: `ticket:${ticket.id}`,
        group: 'SUPPORT',
        kind: 'TICKET_WAITING',
        data: { ticketId: ticket.id, subject: ticket.subject, category: ticket.category, since: ticket.messages[0].createdAt.toISOString() },
        at: ticket.messages[0].createdAt,
        href: `/admin/support/${ticket.id}`,
      }));
  }

  // Security flags still to look at, sign-ins paused right now, and the
  // last day's unresolved errors as one row.
  private async systemItems(now: number): Promise<FeedItem[]> {
    const [flags, refused, errors] = await Promise.all([
      this.prisma.suspiciousActivityFlag.findMany({
        where: { status: { in: [FlagStatus.OPEN, FlagStatus.REVIEWING] }, createdAt: { gte: new Date(now - 7 * DAY_MS) } },
        orderBy: { createdAt: 'desc' },
        take: PER_SOURCE,
        select: { id: true, type: true, description: true, severity: true, createdAt: true },
      }),
      this.prisma.loginAttempt.findMany({ where: { failureReason: 'rate_limited', createdAt: { gte: new Date(now - PAUSE_MS) } }, select: { email: true, ipAddress: true, createdAt: true } }),
      this.prisma.errorLog.findMany({ where: { resolved: false, createdAt: { gte: new Date(now - DAY_MS) } }, orderBy: { createdAt: 'desc' }, take: 500, select: { source: true, severity: true, metadata: true, createdAt: true } }),
    ]);

    const items: FeedItem[] = flags.map((flag) => ({
      id: `flag:${flag.id}`,
      group: 'SYSTEM',
      kind: 'SECURITY_FLAG',
      data: { type: flag.type, description: flag.description, severity: flag.severity },
      at: flag.createdAt,
      href: '/admin/security/flags',
    }));
    for (const pause of pausedNetworks(refused, now)) {
      items.push({
        id: `paused:${pause.ipAddress}`,
        group: 'SYSTEM',
        kind: 'SIGN_INS_PAUSED',
        data: { email: pause.email, ipAddress: pause.ipAddress, until: pause.until.toISOString() },
        at: new Date(pause.until.getTime() - PAUSE_MS),
        href: '/admin/security/logins',
      });
    }
    if (errors.length > 0) {
      const paths = errors.map((error) => {
        const path = (error.metadata as { path?: unknown } | null)?.path;
        return typeof path === 'string' ? path : error.source;
      });
      items.push({
        id: 'errors',
        group: 'SYSTEM',
        kind: 'ERRORS',
        data: { count: errors.length, high: errors.filter((error) => error.severity === 'HIGH' || error.severity === 'CRITICAL').length, top: mostCommon(paths) },
        at: errors[0].createdAt,
        href: '/admin/system/errors',
      });
    }
    return items;
  }
}
