import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TicketStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateIdeaDto } from './dto/create-idea.dto.js';
import { CreateSupportMessageDto, ReplySupportMessageDto } from './dto/support-message.dto.js';
import { subjectOf } from './subject.js';

// What a customer sees of a conversation: no admin ids, no notes the team
// wrote for itself (isInternal), and a screenshot by its id only (its bytes
// come from attachment()).
const CONVERSATION_SELECT = {
  id: true,
  number: true,
  subject: true,
  category: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  messages: {
    where: { isInternal: false },
    orderBy: { createdAt: 'asc' },
    select: { id: true, senderType: true, message: true, createdAt: true, attachment: { select: { id: true } } },
  },
} satisfies Prisma.SupportTicketSelect;

type Conversation = Prisma.SupportTicketGetPayload<{ select: typeof CONVERSATION_SELECT }>;

const toConversation = ({ messages, ...ticket }: Conversation) => ({
  ...ticket,
  messages: messages.map(({ attachment, ...message }) => ({ ...message, attachmentId: attachment?.id ?? null })),
});

// An answer reopens a conversation the team had put down.
const REOPENED_BY_REPLY: TicketStatus[] = [TicketStatus.WAITING_ON_USER, TicketStatus.RESOLVED];
const SHOWN_IDEAS = 100;

// Settings > Help for customers: messages to the support team (the same
// SupportTicket rows the admin inbox works, keyed by the customer's User id)
// and feature ideas with votes. FeatureRequest and its votes keep their old
// platformUserId column name; it holds the User id here too.
@Injectable()
export class SupportService {
  constructor(private readonly prisma: PrismaService) {}

  async createMessage(userId: string, dto: CreateSupportMessageDto, screenshot?: Express.Multer.File) {
    const ticket = await this.prisma.supportTicket.create({
      data: {
        platformUserId: userId,
        subject: subjectOf(dto.message),
        category: dto.category,
        messages: {
          create: {
            senderType: 'USER',
            senderId: userId,
            message: dto.message,
            ...(screenshot && { attachment: { create: { mimeType: screenshot.mimetype, size: screenshot.size, data: new Uint8Array(screenshot.buffer) } } }),
          },
        },
      },
      select: CONVERSATION_SELECT,
    });
    return toConversation(ticket);
  }

  async listMessages(userId: string) {
    const tickets = await this.prisma.supportTicket.findMany({ where: { platformUserId: userId }, orderBy: { updatedAt: 'desc' }, take: 50, select: CONVERSATION_SELECT });
    return tickets.map(toConversation);
  }

  async reply(userId: string, ticketId: string, dto: ReplySupportMessageDto) {
    const ticket = await this.prisma.supportTicket.findFirst({ where: { id: ticketId, platformUserId: userId }, select: { id: true, status: true } });
    if (!ticket) throw new NotFoundException('Conversation not found');
    if (ticket.status === TicketStatus.CLOSED) throw new BadRequestException('This conversation is closed. Send a new message instead.');

    const updated = await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        // Said outright: the queue's staleness reads updatedAt.
        updatedAt: new Date(),
        ...(REOPENED_BY_REPLY.includes(ticket.status) && { status: TicketStatus.OPEN, resolvedAt: null }),
        messages: { create: { senderType: 'USER', senderId: userId, message: dto.message } },
      },
      select: CONVERSATION_SELECT,
    });
    return toConversation(updated);
  }

  // A screenshot from one of the customer's own messages.
  async attachment(userId: string, id: string) {
    const attachment = await this.prisma.ticketAttachment.findFirst({ where: { id, message: { isInternal: false, ticket: { platformUserId: userId } } }, select: { mimeType: true, data: true } });
    if (!attachment) throw new NotFoundException('Screenshot not found');
    return attachment;
  }

  // Everyone's ideas but the declined ones, most wanted first, with whether
  // this customer voted for each and which are theirs.
  async listIdeas(userId: string) {
    const [ideas, votes] = await Promise.all([
      this.prisma.featureRequest.findMany({ where: { status: { not: 'DECLINED' } }, orderBy: [{ voteCount: 'desc' }, { createdAt: 'desc' }], take: SHOWN_IDEAS }),
      this.prisma.featureRequestVote.findMany({ where: { platformUserId: userId }, select: { featureRequestId: true } }),
    ]);
    const voted = new Set(votes.map((vote) => vote.featureRequestId));
    return ideas.map(({ platformUserId, ...idea }) => ({ ...idea, voted: voted.has(idea.id), mine: platformUserId === userId }));
  }

  // A new idea starts with its author's vote.
  async createIdea(userId: string, dto: CreateIdeaDto) {
    const idea = await this.prisma.$transaction(async (tx) => {
      const created = await tx.featureRequest.create({ data: { platformUserId: userId, title: dto.title, description: dto.description ?? '' } });
      await tx.featureRequestVote.create({ data: { featureRequestId: created.id, platformUserId: userId } });
      return created;
    });
    const { platformUserId: _author, ...rest } = idea;
    return { ...rest, voted: true, mine: true };
  }

  // One vote per customer; voting twice, or taking back a vote never
  // given, changes nothing.
  async vote(userId: string, id: string, on: boolean) {
    await this.requireIdea(id);
    await this.prisma.$transaction(async (tx) => {
      if (on) {
        const { count } = await tx.featureRequestVote.createMany({ data: [{ featureRequestId: id, platformUserId: userId }], skipDuplicates: true });
        if (count > 0) await tx.featureRequest.update({ where: { id }, data: { voteCount: { increment: 1 } } });
      } else {
        const { count } = await tx.featureRequestVote.deleteMany({ where: { featureRequestId: id, platformUserId: userId } });
        if (count > 0) await tx.featureRequest.update({ where: { id }, data: { voteCount: { decrement: count } } });
      }
    });
    const idea = await this.prisma.featureRequest.findUniqueOrThrow({ where: { id } });
    const { platformUserId, ...rest } = idea;
    return { ...rest, voted: on, mine: platformUserId === userId };
  }

  private async requireIdea(id: string) {
    const idea = await this.prisma.featureRequest.findUnique({ where: { id }, select: { id: true } });
    if (!idea) throw new NotFoundException('Idea not found');
  }
}
