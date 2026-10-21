import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, TicketPriority, TicketStatus } from '@prisma/client';
import { ADMIN_USER_WHERE, END_USER_WHERE } from '../common/roles.js';
import { MailService } from '../mail/mail.service.js';
import { renderSupportReplyEmail } from '../mail/templates/support-reply-email.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { pushNotification } from '../user-notifications/push.js';
import { AddMessageDto } from './dto/add-message.dto.js';
import { AssignTicketDto } from './dto/assign-ticket.dto.js';
import { CreateTicketDto } from './dto/create-ticket.dto.js';
import { ListTicketsQueryDto, TICKET_STATUS_GROUPS, UNASSIGNED, type TicketStatusFilter } from './dto/list-tickets-query.dto.js';
import { UpdateTicketDto } from './dto/update-ticket.dto.js';

const RESOLVED_STATUSES: TicketStatus[] = [TicketStatus.RESOLVED, TicketStatus.CLOSED];

// A list row's newest message: it says whether the user is waiting on an
// answer.
const LIST_INCLUDE = {
  messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { senderType: true, createdAt: true } },
} satisfies Prisma.SupportTicketInclude;

// sort=waiting puts the highest first, in the enum's order (LOW..URGENT).
const PRIORITY_RANK: Record<TicketPriority, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, URGENT: 3 };

interface WaitingTicket {
  id: string;
  priority: TicketPriority;
  createdAt: Date;
  // The customer's newest message, or the opening when they never wrote.
  waitingSince: Date;
}

// sort=waiting: the most urgent first, then whoever has waited longest.
// The older ticket, then the id, settle a tie, so no row can sit on both
// sides of a page boundary.
const byLongestWaiting = (a: WaitingTicket, b: WaitingTicket) =>
  PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] ||
  a.waitingSince.getTime() - b.waitingSince.getTime() ||
  a.createdAt.getTime() - b.createdAt.getTime() ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// Who a ticket is from. SupportTicket.platformUserId holds a customer's User
// id; tickets from before that may still hold an id from the legacy
// PlatformUser sandbox, which is looked up as a fallback. (The column keeps
// its old name to avoid a migration over live rows.)
export interface Requester {
  id: string;
  name: string;
  email: string;
  plan: { id: string; name: string } | null;
}

const isStatusGroup = (status: TicketStatusFilter): status is keyof typeof TICKET_STATUS_GROUPS => status in TICKET_STATUS_GROUPS;

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  async list(query: ListTicketsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    const where: Prisma.SupportTicketWhereInput = {};
    if (query.status) where.status = isStatusGroup(query.status) ? { in: TICKET_STATUS_GROUPS[query.status] } : query.status;
    if (query.priority) where.priority = query.priority;
    if (query.category) where.category = query.category;
    if (query.assignedToAdminId) where.assignedToAdminId = query.assignedToAdminId === UNASSIGNED ? null : query.assignedToAdminId;
    // On top of the status asked for, not in place of it.
    if (query.awaitingReply) where.AND = [await this.awaitingReplyWhere()];

    if (query.search) {
      const nameOrEmail = {
        OR: [{ name: { contains: query.search, mode: 'insensitive' as const } }, { email: { contains: query.search, mode: 'insensitive' as const } }],
      };
      const [customers, legacyUsers] = await Promise.all([
        this.prisma.user.findMany({ where: { ...END_USER_WHERE, ...nameOrEmail }, select: { id: true } }),
        this.prisma.platformUser.findMany({ where: nameOrEmail, select: { id: true } }),
      ]);
      const requesterIds = [...customers, ...legacyUsers].map((u) => u.id);
      where.OR = [{ subject: { contains: query.search, mode: 'insensitive' } }, { platformUserId: { in: requesterIds } }];
    }

    // sort=waiting ranks by priority, then by how long the customer has
    // waited (longestWaitingPage()). sort=queue, or no sort: unassigned
    // tickets surface first, then by priority (enum declaration order
    // LOW..URGENT means `desc` puts URGENT first), then newest first.
    const [tickets, total] =
      query.sort === 'waiting'
        ? await this.longestWaitingPage(where, page, limit)
        : await Promise.all([
            this.prisma.supportTicket.findMany({
              where,
              orderBy: [{ assignedToAdminId: { sort: 'asc', nulls: 'first' } }, { priority: 'desc' }, { createdAt: 'desc' }],
              skip: (page - 1) * limit,
              take: limit,
              include: LIST_INCLUDE,
            }),
            this.prisma.supportTicket.count({ where }),
          ]);

    const rows = tickets.map(({ messages, ...ticket }) => ({
      ...ticket,
      lastMessageAt: messages[0]?.createdAt ?? null,
      lastMessageFrom: messages[0]?.senderType ?? null,
    }));
    const withUsers = await this.attachRequesters(rows);
    const data = await this.attachAssignedAdmins(withUsers);
    return { data, meta: { page, limit, total, totalPage: Math.ceil(total / limit) } };
  }

  // sort=waiting. How long a ticket has waited lives on its messages, and
  // Prisma orders by a relation's count but never by its newest row, so no
  // single query can page this order. Instead the whole filtered set is
  // ranked here, from an id, a priority and two dates a ticket (the
  // database takes each one's newest customer message), and only the page
  // asked for is loaded in full: every page cuts the same ranking, and the
  // total is its length.
  private async longestWaitingPage(where: Prisma.SupportTicketWhereInput, page: number, limit: number) {
    const [candidates, lastAsked] = await Promise.all([
      this.prisma.supportTicket.findMany({ where, select: { id: true, priority: true, createdAt: true } }),
      this.prisma.ticketMessage.groupBy({ by: ['ticketId'], where: { senderType: 'USER', ticket: where }, _max: { createdAt: true } }),
    ]);
    const askedAt = new Map(lastAsked.map((row) => [row.ticketId, row._max.createdAt]));
    const ranked = candidates.map((ticket) => ({ ...ticket, waitingSince: askedAt.get(ticket.id) ?? ticket.createdAt })).sort(byLongestWaiting);

    const pageIds = ranked.slice((page - 1) * limit, page * limit).map((ticket) => ticket.id);
    const rows = pageIds.length > 0 ? await this.prisma.supportTicket.findMany({ where: { id: { in: pageIds } }, include: LIST_INCLUDE }) : [];
    const byId = new Map(rows.map((row) => [row.id, row]));
    return [pageIds.flatMap((id) => byId.get(id) ?? []), ranked.length] as const;
  }

  async getById(id: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      // A screenshot by its id and type; its bytes come from attachment().
      include: { messages: { orderBy: { createdAt: 'asc' }, include: { attachment: { select: { id: true, mimeType: true, size: true } } } } },
    });
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    const [{ requesters, customerIds }, assignedAdmin] = await Promise.all([
      this.findRequesters([ticket.platformUserId]),
      ticket.assignedToAdminId
        ? this.prisma.user.findUnique({ where: { id: ticket.assignedToAdminId, ...ADMIN_USER_WHERE }, select: { id: true, name: true } })
        : Promise.resolve(null),
    ]);

    // The person's other tickets: how many, and how many were solved.
    const [total, solved] = await Promise.all([
      this.prisma.supportTicket.count({ where: { platformUserId: ticket.platformUserId, id: { not: id } } }),
      this.prisma.supportTicket.count({ where: { platformUserId: ticket.platformUserId, id: { not: id }, status: { in: RESOLVED_STATUSES } } }),
    ]);
    const person = requesters.get(ticket.platformUserId) ?? null;
    return {
      ...ticket,
      platformUser: person,
      // Who wrote in, named as a feature request names its requester:
      // isCustomer when it is a customer's account, whose record the page
      // can open by this id; a legacy platform user has none.
      requester: person && { id: person.id, name: person.name, email: person.email, isCustomer: customerIds.has(person.id) },
      assignedAdmin,
      requesterTickets: { total, solved },
    };
  }

  // Opened by an admin on a customer's behalf (phone, email). The customer
  // used to be picked from the legacy PlatformUser table, which nothing
  // fills, so no ticket could be opened for a real customer.
  async create(dto: CreateTicketDto) {
    const user = await this.prisma.user.findFirst({ where: { id: dto.userId, ...END_USER_WHERE }, select: { id: true } });
    if (!user) {
      throw new NotFoundException('Customer not found');
    }

    return this.prisma.supportTicket.create({
      data: {
        platformUserId: user.id,
        subject: dto.subject,
        category: dto.category,
        priority: dto.priority ?? 'MEDIUM',
        messages: {
          // Logged as the user's own message -- an admin is just relaying it
          // (e.g. phone support), the ticket still represents the user's report.
          create: { senderType: 'USER', senderId: user.id, message: dto.initialMessage },
        },
      },
      include: { messages: true },
    });
  }

  async update(id: string, dto: UpdateTicketDto, adminId: string, ipAddress?: string) {
    const existing = await this.requireTicket(id);
    if (dto.assignedToAdminId) {
      await this.requireAssignableAdmin(dto.assignedToAdminId);
    }
    const statusChanged = dto.status !== undefined && dto.status !== existing.status;

    const resolvedAt = statusChanged ? (RESOLVED_STATUSES.includes(dto.status!) ? new Date() : null) : undefined;

    const result = await this.prisma.supportTicket.update({
      where: { id },
      data: {
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.assignedToAdminId !== undefined && { assignedToAdminId: dto.assignedToAdminId }),
        ...(resolvedAt !== undefined && { resolvedAt }),
      },
    });

    if (statusChanged) {
      await this.prisma.auditLog.create({
        data: {
          adminUserId: adminId,
          action: 'TICKET_UPDATED',
          entityType: 'SupportTicket',
          entityId: id,
          oldValue: { status: existing.status },
          newValue: { status: result.status },
          ipAddress,
        },
      });
    }

    return result;
  }

  async addMessage(id: string, dto: AddMessageDto, adminId: string) {
    const ticket = await this.requireTicket(id);

    const message = await this.prisma.ticketMessage.create({
      data: { ticketId: id, senderType: 'ADMIN', senderId: adminId, message: dto.message, attachmentUrl: dto.attachmentUrl },
    });

    // A reply is activity on the ticket: "in progress for over 24 hours"
    // reads updatedAt, which a new message alone doesn't move.
    await this.prisma.supportTicket.update({
      where: { id },
      data: { updatedAt: new Date(), ...(ticket.status === TicketStatus.OPEN && { status: TicketStatus.IN_PROGRESS }) },
    });

    await this.tellCustomer(ticket, message.id, dto.message);
    return message;
  }

  // A screenshot a customer attached (Settings > Help).
  async attachment(id: string) {
    const attachment = await this.prisma.ticketAttachment.findUnique({ where: { id }, select: { mimeType: true, data: true } });
    if (!attachment) {
      throw new NotFoundException('Attachment not found');
    }
    return attachment;
  }

  // The customer hears about a reply in the app's bell, and by email when
  // email sending is set up. A legacy PlatformUser requester has no app to
  // tell; a failed email is logged and never fails the reply.
  private async tellCustomer(ticket: { id: string; subject: string; platformUserId: string }, messageId: string, reply: string) {
    const customer = await this.prisma.user.findFirst({ where: { id: ticket.platformUserId, ...END_USER_WHERE }, select: { id: true, name: true, email: true } });
    if (!customer) return;
    await pushNotification(this.prisma, customer.id, { key: `support:${messageId}`, type: 'SUPPORT_REPLY', businessId: null, data: { ticketId: ticket.id, subject: ticket.subject } });
    if (!this.configService.get<string>('RESEND_API_KEY')) return;
    const appUrl = this.configService.get<string>('USER_FRONTEND_URL') ?? 'http://localhost:3000';
    const link = `${appUrl}/settings/help?message=${ticket.id}`;
    this.mailService.sendEmail({ to: customer.email, ...renderSupportReplyEmail(customer.name, ticket.subject, reply, link) }).catch((error: unknown) => {
      this.logger.warn(`Support reply email for ticket ${ticket.id} failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  async assign(id: string, dto: AssignTicketDto) {
    await this.requireTicket(id);
    if (dto.adminId) {
      await this.requireAssignableAdmin(dto.adminId);
    }
    return this.prisma.supportTicket.update({ where: { id }, data: { assignedToAdminId: dto.adminId ?? null } });
  }

  // Any id used to be accepted, so a ticket could be "assigned" to a
  // customer, a suspended admin or nobody at all and drop out of every
  // admin's queue.
  private async requireAssignableAdmin(adminId: string) {
    const admin = await this.prisma.user.findFirst({ where: { id: adminId, ...ADMIN_USER_WHERE, status: 'ACTIVE' }, select: { id: true } });
    if (!admin) {
      throw new BadRequestException('Tickets can only be assigned to an active admin');
    }
  }

  // The figures over the queue: what needs a reply and how much of it is
  // unassigned, what is in progress and stale, what waits on the user, what
  // got solved this week and how fast the first reply came.
  async stats() {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [byStatusRaw, unassignedOpenCount, inProgressOver24hCount, urgentCount, solvedThisWeekCount, byCategoryRaw, byPriorityRaw, resolvedTickets, recentTickets, owed] =
      await Promise.all([
        this.prisma.supportTicket.groupBy({ by: ['status'], _count: true }),
        this.prisma.supportTicket.count({ where: { status: 'OPEN', assignedToAdminId: null } }),
        this.prisma.supportTicket.count({ where: { status: 'IN_PROGRESS', updatedAt: { lt: dayAgo } } }),
        this.prisma.supportTicket.count({ where: { priority: 'URGENT', status: { notIn: ['RESOLVED', 'CLOSED'] } } }),
        this.prisma.supportTicket.count({ where: { resolvedAt: { gte: weekAgo } } }),
        this.prisma.supportTicket.groupBy({ by: ['category'], _count: true }),
        this.prisma.supportTicket.groupBy({ by: ['priority'], _count: true }),
        this.prisma.supportTicket.findMany({
          where: { resolvedAt: { not: null } },
          select: { createdAt: true, resolvedAt: true },
        }),
        // The first admin reply on each ticket opened in the last 30 days.
        this.prisma.supportTicket.findMany({
          where: { createdAt: { gte: monthAgo } },
          select: { createdAt: true, messages: { where: { senderType: 'ADMIN' }, orderBy: { createdAt: 'asc' }, take: 1, select: { createdAt: true } } },
        }),
        // The tickets that owe the customer a reply, and since when: the
        // list's "waiting on us", which list(awaitingReply) shows.
        this.awaitingReply(),
      ]);

    const hours = (ms: number) => ms / (1000 * 60 * 60);
    const avgResolutionHours =
      resolvedTickets.length > 0 ? hours(resolvedTickets.reduce((sum, t) => sum + (t.resolvedAt!.getTime() - t.createdAt.getTime()), 0) / resolvedTickets.length) : 0;
    const answered = recentTickets.filter((t) => t.messages.length > 0);
    const avgFirstReplyHours =
      answered.length > 0 ? hours(answered.reduce((sum, t) => sum + (t.messages[0].createdAt.getTime() - t.createdAt.getTime()), 0) / answered.length) : 0;

    const needsReplyCount = owed.length;
    const needsReplyOver24hCount = owed.filter((ticket) => ticket.since < dayAgo).length;

    const statusCounts = Object.fromEntries(Object.values(TicketStatus).map((status) => [status, 0])) as Record<TicketStatus, number>;
    for (const row of byStatusRaw) statusCounts[row.status] = row._count;

    return {
      openCount: statusCounts.OPEN,
      unassignedOpenCount,
      inProgressCount: statusCounts.IN_PROGRESS,
      inProgressOver24hCount,
      needsReplyCount,
      needsReplyOver24hCount,
      waitingOnUserCount: statusCounts.WAITING_ON_USER,
      urgentCount,
      solvedThisWeekCount,
      avgResolutionHours: Math.round(avgResolutionHours * 10) / 10,
      avgFirstReplyHours: Math.round(avgFirstReplyHours * 10) / 10,
      statusCounts,
      byCategory: byCategoryRaw.map((r) => ({ category: r.category, count: r._count })),
      byPriority: byPriorityRaw.map((r) => ({ priority: r.priority, count: r._count })),
    };
  }

  // The queue's "needs a reply": an unsolved ticket whose newest message is
  // the customer's, or that has none yet. The team owes them an answer
  // whatever the status says, since that message (or the opening). stats()
  // counts this list and list(awaitingReply) filters by it, so the figure
  // and the filtered list's total agree.
  private async awaitingReply(): Promise<{ id: string; since: Date }[]> {
    const unsolved = await this.prisma.supportTicket.findMany({
      where: { status: { notIn: RESOLVED_STATUSES } },
      select: { id: true, createdAt: true, messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { senderType: true, createdAt: true } } },
    });
    return unsolved.flatMap((ticket) => {
      const last = ticket.messages.at(0);
      if (!last) return [{ id: ticket.id, since: ticket.createdAt }];
      return last.senderType === 'USER' ? [{ id: ticket.id, since: last.createdAt }] : [];
    });
  }

  // The same rule as a list filter. Who wrote last is a fact about each
  // ticket's newest message, which no Prisma where can state, so the rule
  // travels as the ids it matched.
  private async awaitingReplyWhere(): Promise<Prisma.SupportTicketWhereInput> {
    const owed = await this.awaitingReply();
    return { status: { notIn: RESOLVED_STATUSES }, id: { in: owed.map((ticket) => ticket.id) } };
  }

  private async requireTicket(id: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }
    return ticket;
  }

  private async attachRequesters<T extends { platformUserId: string }>(tickets: T[]) {
    const { requesters } = await this.findRequesters(tickets.map((t) => t.platformUserId));
    return tickets.map((t) => ({ ...t, platformUser: requesters.get(t.platformUserId) ?? null }));
  }

  // Customers first; ids not found there are looked up in the legacy
  // PlatformUser table. A customer's plan is their default workspace's.
  // customerIds holds the ones found as customers.
  private async findRequesters(ids: string[]): Promise<{ requesters: Map<string, Requester>; customerIds: Set<string> }> {
    const unique = [...new Set(ids)];
    const customers = await this.prisma.user.findMany({
      where: { id: { in: unique }, ...END_USER_WHERE },
      select: {
        id: true,
        name: true,
        email: true,
        ownedBusinesses: { where: { isDefault: true, deletedAt: null }, select: { plan: { select: { id: true, name: true } } }, take: 1 },
      },
    });
    const found = new Map<string, Requester>(
      customers.map((u) => [u.id, { id: u.id, name: u.name, email: u.email, plan: u.ownedBusinesses[0]?.plan ?? null }]),
    );

    const missing = unique.filter((id) => !found.has(id));
    if (missing.length > 0) {
      const legacy = await this.prisma.platformUser.findMany({
        where: { id: { in: missing } },
        select: { id: true, name: true, email: true, plan: { select: { id: true, name: true } } },
      });
      for (const u of legacy) found.set(u.id, u);
    }
    return { requesters: found, customerIds: new Set(customers.map((u) => u.id)) };
  }

  private async attachAssignedAdmins<T extends { assignedToAdminId: string | null }>(tickets: T[]) {
    const adminIds = [...new Set(tickets.map((t) => t.assignedToAdminId).filter((id): id is string => Boolean(id)))];
    const admins = await this.prisma.user.findMany({
      where: { id: { in: adminIds }, ...ADMIN_USER_WHERE },
      select: { id: true, name: true },
    });
    const adminById = new Map(admins.map((a) => [a.id, a]));
    return tickets.map((t) => ({ ...t, assignedAdmin: t.assignedToAdminId ? (adminById.get(t.assignedToAdminId) ?? null) : null }));
  }
}
