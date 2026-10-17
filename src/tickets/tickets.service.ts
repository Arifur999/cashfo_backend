import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TicketStatus } from '@prisma/client';
import { ADMIN_USER_WHERE, END_USER_WHERE } from '../common/roles.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AddMessageDto } from './dto/add-message.dto.js';
import { AssignTicketDto } from './dto/assign-ticket.dto.js';
import { CreateTicketDto } from './dto/create-ticket.dto.js';
import { ListTicketsQueryDto } from './dto/list-tickets-query.dto.js';
import { UpdateTicketDto } from './dto/update-ticket.dto.js';

const RESOLVED_STATUSES: TicketStatus[] = [TicketStatus.RESOLVED, TicketStatus.CLOSED];

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

@Injectable()
export class TicketsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListTicketsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    const where: Prisma.SupportTicketWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.priority) where.priority = query.priority;
    if (query.category) where.category = query.category;
    if (query.assignedToAdminId) where.assignedToAdminId = query.assignedToAdminId;

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

    // Default sort: unassigned tickets surface first, then by priority
    // (enum declaration order LOW..URGENT means `desc` puts URGENT first),
    // then newest first.
    const [tickets, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        orderBy: [{ assignedToAdminId: { sort: 'asc', nulls: 'first' } }, { priority: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        // The last message says whether the user is waiting on an answer.
        include: { messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { senderType: true, createdAt: true } } },
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

  async getById(id: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    const [requesters, assignedAdmin] = await Promise.all([
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
    return { ...ticket, platformUser: requesters.get(ticket.platformUserId) ?? null, assignedAdmin, requesterTickets: { total, solved } };
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

    if (ticket.status === TicketStatus.OPEN) {
      await this.prisma.supportTicket.update({ where: { id }, data: { status: TicketStatus.IN_PROGRESS } });
    }

    return message;
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
    const [byStatusRaw, unassignedOpenCount, inProgressOver24hCount, urgentCount, solvedThisWeekCount, byCategoryRaw, byPriorityRaw, resolvedTickets, recentTickets] =
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
      ]);

    const hours = (ms: number) => ms / (1000 * 60 * 60);
    const avgResolutionHours =
      resolvedTickets.length > 0 ? hours(resolvedTickets.reduce((sum, t) => sum + (t.resolvedAt!.getTime() - t.createdAt.getTime()), 0) / resolvedTickets.length) : 0;
    const answered = recentTickets.filter((t) => t.messages.length > 0);
    const avgFirstReplyHours =
      answered.length > 0 ? hours(answered.reduce((sum, t) => sum + (t.messages[0].createdAt.getTime() - t.createdAt.getTime()), 0) / answered.length) : 0;

    const statusCounts = Object.fromEntries(Object.values(TicketStatus).map((status) => [status, 0])) as Record<TicketStatus, number>;
    for (const row of byStatusRaw) statusCounts[row.status] = row._count;

    return {
      openCount: statusCounts.OPEN,
      unassignedOpenCount,
      inProgressCount: statusCounts.IN_PROGRESS,
      inProgressOver24hCount,
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

  private async requireTicket(id: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }
    return ticket;
  }

  private async attachRequesters<T extends { platformUserId: string }>(tickets: T[]) {
    const requesters = await this.findRequesters(tickets.map((t) => t.platformUserId));
    return tickets.map((t) => ({ ...t, platformUser: requesters.get(t.platformUserId) ?? null }));
  }

  // Customers first; ids not found there are looked up in the legacy
  // PlatformUser table. A customer's plan is their default workspace's.
  private async findRequesters(ids: string[]): Promise<Map<string, Requester>> {
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
    return found;
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
