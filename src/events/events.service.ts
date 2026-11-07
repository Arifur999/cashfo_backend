import { BadRequestException, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { Prisma, type EventGift, type EventPerson, type SocialEvent } from '@prisma/client';
import { HousekeepingScheduler } from '../housekeeping/housekeeping.scheduler.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PushService } from '../push/push.service.js';
import { CreateEventDto, CreateGiftDto, UpdateEventDto, UpdateGiftDto, UpdatePersonDto } from './dto/events.dto.js';
import { reminderDay, reminderKey } from './event-reminders.js';

const FIVE_MINUTES = 5 * 60 * 1000;
// A workspace's events, people and gifts are read in one go; this many
// events is years of invitations.
const MAX_EVENTS = 3000;

const dayOf = (date: Date) => date.toISOString().slice(0, 10);
const dateOf = (day: string) => new Date(`${day}T00:00:00.000Z`);

type EventRow = SocialEvent & { gifts: EventGift[] };

// The bell row's data for an event reminder (UserNotification type EVENT).
export interface EventReminderData {
  eventId: string;
  title: string;
  date: string;
  time: string | null;
  place: string | null;
  url: string;
}

// Calendar & Events: invitations and the customer's own events, the
// people they are with, and the gifts given and received at them. A
// record of social giving: a cash gift moves no wallet.
@Injectable()
export class EventsService implements OnModuleInit {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
    private readonly housekeeping: HousekeepingScheduler,
  ) {}

  onModuleInit() {
    this.housekeeping.register({ name: 'event-reminders', everyMs: FIVE_MINUTES, run: (now) => this.sendReminders(now) });
  }

  // Everything the three pages draw: the people, and every event with its
  // gifts, oldest first.
  async overview(businessId: string) {
    const [people, events] = await Promise.all([
      this.prisma.eventPerson.findMany({ where: { businessId }, orderBy: { name: 'asc' } }),
      this.prisma.socialEvent.findMany({ where: { businessId }, include: { gifts: { orderBy: { createdAt: 'asc' } } }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }], take: MAX_EVENTS }),
    ]);
    return { people: people.map(personView), events: events.map(eventView) };
  }

  async createEvent(businessId: string, dto: CreateEventDto) {
    const event = await this.prisma.$transaction(async (tx) => {
      const hostId = dto.mine ? null : await this.personFor(tx, businessId, dto.hostId, dto.hostName, dto.hostRelation);
      return tx.socialEvent.create({
        data: { businessId, type: dto.type, title: dto.title, date: dateOf(dto.date), time: dto.time || null, place: dto.place || null, hostId, remind: dto.remind ?? true },
        include: { gifts: true },
      });
    });
    return eventView(event);
  }

  async updateEvent(businessId: string, id: string, dto: UpdateEventDto) {
    await this.requireEvent(businessId, id);
    const event = await this.prisma.socialEvent.update({
      where: { id },
      data: {
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.date !== undefined && { date: dateOf(dto.date) }),
        ...(dto.time !== undefined && { time: dto.time || null }),
        ...(dto.place !== undefined && { place: dto.place || null }),
        ...(dto.remind !== undefined && { remind: dto.remind }),
      },
      include: { gifts: { orderBy: { createdAt: 'asc' } } },
    });
    return eventView(event);
  }

  // The event and its gifts go; the people stay, with their other gifts.
  async deleteEvent(businessId: string, id: string) {
    await this.requireEvent(businessId, id);
    await this.prisma.socialEvent.delete({ where: { id } });
    return { deleted: true };
  }

  // A gift at someone else's event is given to its host; at the customer's
  // own, it is received from the person named.
  async addGift(businessId: string, eventId: string, dto: CreateGiftDto) {
    const event = await this.requireEvent(businessId, eventId);
    const mine = event.hostId === null;
    const gift = await this.prisma.$transaction(async (tx) => {
      const personId = mine ? await this.personFor(tx, businessId, dto.personId, dto.personName, dto.personRelation) : (dto.personId ?? event.hostId);
      if (!personId) throw new BadRequestException('Say who the gift is from.');
      if (!mine && personId !== event.hostId) throw new BadRequestException('A gift at an invitation goes to its host.');
      return tx.eventGift.create({
        data: { businessId, eventId, personId, direction: mine ? 'GOT' : 'GAVE', kind: dto.kind, item: dto.kind === 'ITEM' ? (dto.item ?? null) : null, amount: dto.amount, note: dto.note || null },
      });
    });
    return giftView(gift);
  }

  async updateGift(businessId: string, giftId: string, dto: UpdateGiftDto) {
    const gift = await this.prisma.eventGift.findUnique({ where: { id: giftId } });
    if (!gift || gift.businessId !== businessId) throw new NotFoundException('Gift not found');
    const kind = dto.kind ?? gift.kind;
    const item = kind === 'ITEM' ? (dto.item !== undefined ? dto.item : gift.item) : null;
    if (kind === 'ITEM' && !item) throw new BadRequestException('Say what the gift was.');
    const updated = await this.prisma.eventGift.update({
      where: { id: giftId },
      data: { kind, item, ...(dto.amount !== undefined && { amount: dto.amount }), ...(dto.note !== undefined && { note: dto.note || null }) },
    });
    return giftView(updated);
  }

  async deleteGift(businessId: string, giftId: string) {
    const gift = await this.prisma.eventGift.findUnique({ where: { id: giftId } });
    if (!gift || gift.businessId !== businessId) throw new NotFoundException('Gift not found');
    await this.prisma.eventGift.delete({ where: { id: giftId } });
    return { deleted: true };
  }

  async updatePerson(businessId: string, id: string, dto: UpdatePersonDto) {
    const person = await this.prisma.eventPerson.findUnique({ where: { id } });
    if (!person || person.businessId !== businessId) throw new NotFoundException('Person not found');
    const updated = await this.prisma.eventPerson.update({
      where: { id },
      data: { ...(dto.name !== undefined && { name: dto.name }), ...(dto.relation !== undefined && { relation: dto.relation || null }) },
    });
    return personView(updated);
  }

  // Tomorrow's events with a reminder on, as bell rows for the workspace's
  // owner: one per event and day (the key), so a second server or a later
  // tick never writes it twice; only new rows are pushed.
  async sendReminders(now: Date) {
    const day = reminderDay(now);
    if (!day) return;
    const due = await this.prisma.socialEvent.findMany({
      where: { remind: true, date: dateOf(day), business: { owner: { status: 'ACTIVE' } } },
      select: { id: true, title: true, date: true, time: true, place: true, businessId: true, business: { select: { ownerId: true } } },
    });
    if (due.length === 0) return;
    const inserted = await this.prisma.userNotification.createManyAndReturn({
      data: due.map((event) => ({
        userId: event.business.ownerId,
        businessId: event.businessId,
        type: 'EVENT' as const,
        key: reminderKey(event.id, day),
        data: { eventId: event.id, title: event.title, date: dayOf(event.date), time: event.time, place: event.place, url: '/events' } satisfies EventReminderData as unknown as Prisma.InputJsonObject,
      })),
      skipDuplicates: true,
      select: { userId: true, data: true },
    });
    if (inserted.length === 0) return;
    try {
      await this.push.send(
        inserted.map((row) => {
          const data = row.data as unknown as EventReminderData;
          return {
            userId: row.userId,
            build: (locale: 'en' | 'bn') =>
              locale === 'bn'
                ? { title: data.title, body: `আগামীকাল${data.time ? ` ${data.time}` : ''}${data.place ? ` · ${data.place}` : ''}`, url: data.url, tag: `event-${data.eventId}` }
                : { title: data.title, body: `Tomorrow${data.time ? ` at ${data.time}` : ''}${data.place ? ` · ${data.place}` : ''}`, url: data.url, tag: `event-${data.eventId}` },
          };
        }),
      );
    } catch (error) {
      // The bell has them; a push that fails is only logged.
      this.logger.warn(`Event reminder push failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // A person by id (in this workspace), or a new one by name -- the same
  // name again is the same person, so typing it twice doesn't split them.
  private async personFor(tx: Prisma.TransactionClient, businessId: string, personId: string | undefined, name: string | undefined, relation: string | undefined): Promise<string> {
    if (personId) {
      const person = await tx.eventPerson.findUnique({ where: { id: personId } });
      if (!person || person.businessId !== businessId) throw new NotFoundException('Person not found');
      return person.id;
    }
    const trimmed = name?.trim();
    if (!trimmed) throw new BadRequestException('Say whose event it is.');
    const known = await tx.eventPerson.findFirst({ where: { businessId, name: { equals: trimmed, mode: 'insensitive' } } });
    if (known) return known.id;
    const created = await tx.eventPerson.create({ data: { businessId, name: trimmed, relation: relation?.trim() || null } });
    return created.id;
  }

  private async requireEvent(businessId: string, id: string) {
    const event = await this.prisma.socialEvent.findUnique({ where: { id } });
    if (!event || event.businessId !== businessId) throw new NotFoundException('Event not found');
    return event;
  }
}

function personView(person: EventPerson) {
  return { id: person.id, name: person.name, relation: person.relation };
}

function giftView(gift: EventGift) {
  return { id: gift.id, eventId: gift.eventId, personId: gift.personId, direction: gift.direction, kind: gift.kind, item: gift.item, amount: gift.amount.toFixed(2), note: gift.note, createdAt: gift.createdAt };
}

function eventView(event: EventRow) {
  return {
    id: event.id,
    type: event.type,
    title: event.title,
    date: dayOf(event.date),
    time: event.time,
    place: event.place,
    hostId: event.hostId,
    mine: event.hostId === null,
    remind: event.remind,
    gifts: event.gifts.map(giftView),
  };
}
