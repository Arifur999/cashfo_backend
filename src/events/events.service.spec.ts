import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventsService } from './events.service.js';
import type { CreateEventDto, CreateGiftDto } from './dto/events.dto.js';

const D = (value: number) => new Prisma.Decimal(value);

const setup = (opts: { people?: { id: string; name: string }[]; event?: Record<string, unknown> } = {}) => {
  const people = [...(opts.people ?? [])].map((p) => ({ businessId: 'biz-1', relation: null, ...p }));
  const tx = {
    eventPerson: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) => Promise.resolve(people.find((p) => p.id === where.id) ?? null)),
      findFirst: vi.fn(({ where }: { where: { name: { equals: string } } }) => Promise.resolve(people.find((p) => p.name.toLowerCase() === where.name.equals.toLowerCase()) ?? null)),
      create: vi.fn(({ data }: { data: { name: string } }) => Promise.resolve({ id: 'new-person', ...data })),
    },
    socialEvent: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'ev-new', createdAt: new Date(), ...data, gifts: [] })),
    },
    eventGift: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'gift-new', createdAt: new Date(), ...data, amount: D(Number(data.amount)) })),
    },
  };
  const prisma = {
    $transaction: vi.fn((run: (client: typeof tx) => unknown) => run(tx)),
    socialEvent: { findUnique: vi.fn(() => Promise.resolve(opts.event ?? null)), findMany: vi.fn(() => Promise.resolve([])) },
    userNotification: { createManyAndReturn: vi.fn(() => Promise.resolve([])) },
  };
  const push = { send: vi.fn(() => Promise.resolve(0)) };
  const housekeeping = { register: vi.fn() };
  return { service: new EventsService(prisma as never, push as never, housekeeping as never), prisma, tx, push };
};

const event = (over: Partial<CreateEventDto> = {}) => ({ type: 'WEDDING', title: "Sumaiya Apu's wedding", date: '2026-11-07', mine: false, ...over }) as CreateEventDto;
const gift = (over: Partial<CreateGiftDto> = {}) => ({ kind: 'CASH', amount: 2000, ...over }) as CreateGiftDto;

describe('EventsService', () => {
  it('keeps one person for a name typed again, whatever its case', async () => {
    const { service, tx } = setup({ people: [{ id: 'p-sumaiya', name: 'Sumaiya Apu' }] });
    await service.createEvent('biz-1', event({ hostName: 'sumaiya apu' }));
    expect(tx.eventPerson.create).not.toHaveBeenCalled();
    expect(tx.socialEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ hostId: 'p-sumaiya', remind: true }) }));
  });

  it("gives a gift at an invitation to its host, and nobody else", async () => {
    const { service, tx } = setup({ people: [{ id: 'p-sumaiya', name: 'Sumaiya Apu' }], event: { id: 'ev1', businessId: 'biz-1', hostId: 'p-sumaiya' } });
    await service.addGift('biz-1', 'ev1', gift());
    expect(tx.eventGift.create).toHaveBeenCalledWith({ data: expect.objectContaining({ direction: 'GAVE', personId: 'p-sumaiya', kind: 'CASH', item: null }) });
    await expect(service.addGift('biz-1', 'ev1', gift({ personId: 'p-other' }))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('receives a gift at the customer’s own event from a new person by name', async () => {
    const { service, tx } = setup({ event: { id: 'ev2', businessId: 'biz-1', hostId: null } });
    const saved = await service.addGift('biz-1', 'ev2', gift({ personName: 'Nusrat', kind: 'ITEM', item: 'Baby clothes', amount: 1200 }));
    expect(tx.eventPerson.create).toHaveBeenCalledWith({ data: { businessId: 'biz-1', name: 'Nusrat', relation: null } });
    expect(saved).toMatchObject({ direction: 'GOT', kind: 'ITEM', item: 'Baby clothes', amount: '1200.00' });
  });

  it('writes tomorrow’s reminders only from 9 in the morning, keyed by event and day', async () => {
    const { service, prisma } = setup();
    await service.sendReminders(new Date('2026-11-05T02:00:00.000Z'));
    expect(prisma.socialEvent.findMany).not.toHaveBeenCalled();
    prisma.socialEvent.findMany.mockResolvedValueOnce([{ id: 'ev3', title: 'Milad', date: new Date('2026-11-06T00:00:00.000Z'), time: '17:00', place: null, businessId: 'biz-1', business: { ownerId: 'u1' } }] as never);
    await service.sendReminders(new Date('2026-11-05T04:00:00.000Z'));
    expect(prisma.userNotification.createManyAndReturn).toHaveBeenCalledWith(expect.objectContaining({ data: [expect.objectContaining({ userId: 'u1', type: 'EVENT', key: 'event:ev3:2026-11-06' })], skipDuplicates: true }));
  });
});
