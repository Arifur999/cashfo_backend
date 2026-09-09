import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TicketStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AddMessageDto } from './dto/add-message.dto.js';
import { AssignTicketDto } from './dto/assign-ticket.dto.js';
import { CreateTicketDto } from './dto/create-ticket.dto.js';
import { ListTicketsQueryDto } from './dto/list-tickets-query.dto.js';
import { UpdateTicketDto } from './dto/update-ticket.dto.js';

const RESOLVED_STATUSES: TicketStatus[] = [TicketStatus.RESOLVED, TicketStatus.CLOSED];

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
      const matchingUsers = await this.prisma.platformUser.findMany({
        where: {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { email: { contains: query.search, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      });
      where.OR = [
        { subject: { contains: query.search, mode: 'insensitive' } },
        { platformUserId: { in: matchingUsers.map((u) => u.id) } },
      ];
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
      }),
      this.prisma.supportTicket.count({ where }),
    ]);

    const withUsers = await this.attachPlatformUsers(tickets);
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

    const [platformUser, assignedAdmin] = await Promise.all([
      this.prisma.platformUser.findUnique({
        where: { id: ticket.platformUserId },
        select: { id: true, name: true, email: true, plan: { select: { id: true, name: true } } },
      }),
      ticket.assignedToAdminId
        ? this.prisma.adminUser.findUnique({ where: { id: ticket.assignedToAdminId }, select: { id: true, name: true } })
        : Promise.resolve(null),
    ]);

    return { ...ticket, platformUser, assignedAdmin };
  }

  async create(dto: CreateTicketDto) {
    const user = await this.prisma.platformUser.findUnique({ where: { id: dto.platformUserId } });
    if (!user) {
      throw new NotFoundException('Platform user not found');
    }

    return this.prisma.supportTicket.create({
      data: {
        platformUserId: dto.platformUserId,
        subject: dto.subject,
        category: dto.category,
        priority: dto.priority ?? 'MEDIUM',
        messages: {
          // Logged as the user's own message -- an admin is just relaying it
          // (e.g. phone support), the ticket still represents the user's report.
          create: { senderType: 'USER', senderId: dto.platformUserId, message: dto.initialMessage },
        },
      },
      include: { messages: true },
    });
  }

  async update(id: string, dto: UpdateTicketDto, adminId: string, ipAddress?: string) {
    const existing = await this.requireTicket(id);
    const statusChanged = dto.status !== undefined && dto.status !== existing.status;

    const resolvedAt = statusChanged
      ? RESOLVED_STATUSES.includes(dto.status!)
        ? new Date()
        : null
      : undefined;

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
    return this.prisma.supportTicket.update({ where: { id }, data: { assignedToAdminId: dto.adminId ?? null } });
  }

  async stats() {
    const [openCount, inProgressCount, urgentCount, byCategoryRaw, byPriorityRaw, resolvedTickets] = await Promise.all([
      this.prisma.supportTicket.count({ where: { status: 'OPEN' } }),
      this.prisma.supportTicket.count({ where: { status: 'IN_PROGRESS' } }),
      this.prisma.supportTicket.count({ where: { priority: 'URGENT', status: { notIn: ['RESOLVED', 'CLOSED'] } } }),
      this.prisma.supportTicket.groupBy({ by: ['category'], _count: true }),
      this.prisma.supportTicket.groupBy({ by: ['priority'], _count: true }),
      this.prisma.supportTicket.findMany({
        where: { resolvedAt: { not: null } },
        select: { createdAt: true, resolvedAt: true },
      }),
    ]);

    const avgResolutionHours =
      resolvedTickets.length > 0
        ? resolvedTickets.reduce((sum, t) => sum + (t.resolvedAt!.getTime() - t.createdAt.getTime()), 0) /
          resolvedTickets.length /
          (1000 * 60 * 60)
        : 0;

    return {
      openCount,
      inProgressCount,
      urgentCount,
      avgResolutionHours: Math.round(avgResolutionHours * 10) / 10,
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

  private async attachPlatformUsers<T extends { platformUserId: string }>(tickets: T[]) {
    const userIds = [...new Set(tickets.map((t) => t.platformUserId))];
    const users = await this.prisma.platformUser.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true },
    });
    const userById = new Map(users.map((u) => [u.id, u]));
    return tickets.map((t) => ({ ...t, platformUser: userById.get(t.platformUserId) ?? null }));
  }

  private async attachAssignedAdmins<T extends { assignedToAdminId: string | null }>(tickets: T[]) {
    const adminIds = [...new Set(tickets.map((t) => t.assignedToAdminId).filter((id): id is string => Boolean(id)))];
    const admins = await this.prisma.adminUser.findMany({
      where: { id: { in: adminIds } },
      select: { id: true, name: true },
    });
    const adminById = new Map(admins.map((a) => [a.id, a]));
    return tickets.map((t) => ({ ...t, assignedAdmin: t.assignedToAdminId ? (adminById.get(t.assignedToAdminId) ?? null) : null }));
  }
}
