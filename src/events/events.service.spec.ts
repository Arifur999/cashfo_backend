import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventsService } from './events.service.js';
import type { CreateEventDto, CreateGiftDto } from './dto/events.dto.js';

const D = (value: number) => new Prisma.Decimal(value);

const setup = (opts: { people?: { id: string; name: string }[]; event?: Record<string, unknown>; balance?: number; gift?: Record<string, unknown> } = {}) => {
  const people = [...(opts.people ?? [])].map((p) => ({ businessId: 'biz-1', relation: null, ...p }));
  const tx = {
    eventPerson: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) => Promise.resolve(people.find((p) => p.id === where.id) ?? null)),
      findFirst: vi.fn(({ where }: { where: { name: { equals: string } } }) => Promise.resolve(people.find((p) => p.name.toLowerCase() === where.name.equals.toLowerCase()) ?? null)),
      create: vi.fn(({ data }: { data: { name: string } }) => Promise.resolve({ id: 'new-person', ...data })),
    },
    socialEvent: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'ev-new', createdAt: new Date(), ...data, gifts: [] })),
      findUnique: vi.fn(() => Promise.resolve(opts.event ?? null)),
    },
    $queryRaw: vi.fn(() => Promise.resolve([])),
    eventGift: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'gift-new', createdAt: new Date(), ...data, amount: D(Number(data.amount)) })),
      delete: vi.fn(() => Promise.resolve({})),
    },
    account: {
      findFirst: vi.fn(({ where }: { where: { accountType: string; id?: string } }) =>
        Promise.resolve(where.accountType === 'EXPENSE' ? { id: 'acc-expense' } : where.id === 'acc-cash' ? { id: 'acc-cash' } : null),
      ),
      findUniqueOrThrow: vi.fn(() => Promise.resolve({ currentBalance: D(opts.balance ?? 10000) })),
    },
    budgetCategory: { count: vi.fn(() => Promise.resolve(0)), findMany: vi.fn(() => Promise.resolve([])), createMany: vi.fn(() => Promise.resolve({ count: 1 })) },
    transaction: { findUnique: vi.fn(() => Promise.resolve({ status: 'POSTED' })) },
    $executeRaw: vi.fn(() => Promise.resolve(1)),
  };
  const prisma = {
    $transaction: vi.fn((run: (client: typeof tx) => unknown) => run(tx)),
    socialEvent: { findUnique: vi.fn(() => Promise.resolve(opts.event ?? null)), findMany: vi.fn(() => Promise.resolve([])) },
    eventGift: { findUnique: vi.fn(() => Promise.resolve(opts.gift ?? null)) },
    userNotification: { createManyAndReturn: vi.fn(() => Promise.resolve([])) },
  };
  const push = { send: vi.fn(() => Promise.resolve(0)) };
  const housekeeping = { register: vi.fn() };
  const transactions = { createTransaction: vi.fn(() => Promise.resolve({ id: 'tx-gift' })), voidTransaction: vi.fn(() => Promise.resolve({})) };
  return { service: new EventsService(prisma as never, push as never, housekeeping as never, transactions as never, { forUsers: vi.fn().mockResolvedValue(new Map()), allowed: () => false } as never, { configured: false } as never), prisma, tx, push, transactions };
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

  it('gives a gift at an invitation to its host unless someone else is picked, either way round', async () => {
    const people = [
      { id: 'p-sumaiya', name: 'Sumaiya Apu' },
      { id: 'p-rafi', name: 'Rafi' },
    ];
    const { service, tx, transactions } = setup({ people, event: { id: 'ev1', businessId: 'biz-1', hostId: 'p-sumaiya' } });
    await service.addGift('biz-1', 'ev1', gift(), 'u1');
    expect(tx.eventGift.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ direction: 'GAVE', personId: 'p-sumaiya', kind: 'CASH', item: null, transactionId: null }) });
    await service.addGift('biz-1', 'ev1', gift({ personId: 'p-rafi', direction: 'GOT' }), 'u1');
    expect(tx.eventGift.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ direction: 'GOT', personId: 'p-rafi' }) });
    expect(transactions.createTransaction).not.toHaveBeenCalled();
  });

  it('adds cash given to Transactions as a Gifts expense from the wallet, dated the event', async () => {
    const { service, tx, transactions } = setup({ event: { id: 'ev1', businessId: 'biz-1', hostId: 'p-h', title: 'Rafi wedding', date: new Date('2026-10-02T00:00:00.000Z') } });
    const saved = await service.addGift('biz-1', 'ev1', gift({ fromAccountId: 'acc-cash' }), 'u1');
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(tx.budgetCategory.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: [expect.objectContaining({ name: 'Gifts', type: 'EXPENSE' })] }));
    expect(transactions.createTransaction).toHaveBeenCalledWith(
      'biz-1',
      expect.objectContaining({
        transactionType: 'EXPENSE',
        transactionDate: '2026-10-02',
        description: 'Gift · Rafi wedding',
        entries: [
          { accountId: 'acc-expense', entryType: 'DEBIT', amount: 2000, categoryId: 'Gifts' },
          { accountId: 'acc-cash', entryType: 'CREDIT', amount: 2000 },
        ],
      }),
      'u1',
      tx,
    );
    expect(tx.eventGift.create).toHaveBeenCalledWith({ data: expect.objectContaining({ transactionId: 'tx-gift' }) });
    expect(saved.inTransactions).toBe(true);
  });

  it('refuses Transactions for anything but cash given, another workspace wallet, or a wallet short of the amount', async () => {
    const at = { event: { id: 'ev1', businessId: 'biz-1', hostId: 'p-h', title: 'X', date: new Date('2026-10-02T00:00:00.000Z') } };
    const { service, transactions } = setup(at);
    await expect(service.addGift('biz-1', 'ev1', gift({ fromAccountId: 'acc-cash', direction: 'GOT' }), 'u1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.addGift('biz-1', 'ev1', gift({ fromAccountId: 'acc-cash', kind: 'ITEM', item: 'Ring' }), 'u1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.addGift('biz-1', 'ev1', gift({ fromAccountId: 'acc-elsewhere' }), 'u1')).rejects.toThrow('Pick a cash, bank or mobile banking wallet.');
    const short = setup({ ...at, balance: 500 });
    await expect(short.service.addGift('biz-1', 'ev1', gift({ fromAccountId: 'acc-cash' }), 'u1')).rejects.toThrow("This wallet doesn't have that much. Pick another wallet.");
    expect(transactions.createTransaction).not.toHaveBeenCalled();
  });

  it('voids the expense with the gift, and keeps the amount of one in Transactions', async () => {
    const posted = { id: 'g1', businessId: 'biz-1', kind: 'CASH', amount: D(2000), transactionId: 'tx-gift' };
    const { service, tx, transactions } = setup({ gift: posted });
    await service.deleteGift('biz-1', 'g1', 'u1');
    expect(tx.eventGift.delete).toHaveBeenCalledWith({ where: { id: 'g1' } });
    expect(transactions.voidTransaction).toHaveBeenCalledWith('biz-1', 'tx-gift', 'Gift deleted from Calendar & Events', 'u1', tx);
    await expect(service.updateGift('biz-1', 'g1', { amount: 2500 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('receives a gift at the customer’s own event from a new person by name', async () => {
    const { service, tx } = setup({ event: { id: 'ev2', businessId: 'biz-1', hostId: null } });
    const saved = await service.addGift('biz-1', 'ev2', gift({ personName: 'Nusrat', kind: 'ITEM', item: 'Baby clothes', amount: 1200 }), 'u1');
    expect(tx.eventPerson.create).toHaveBeenCalledWith({ data: { businessId: 'biz-1', name: 'Nusrat', relation: null } });
    expect(saved).toMatchObject({ direction: 'GOT', kind: 'ITEM', item: 'Baby clothes', amount: '1200.00' });
  });

  it('writes tomorrow’s reminders only from 9 in the morning, keyed by event and day', async () => {
    const { service, prisma } = setup();
    await service.sendReminders(new Date('2026-11-05T02:00:00.000Z'));
    expect(prisma.socialEvent.findMany).not.toHaveBeenCalled();
    const event = (id: string, date: string, ownerId: string, eventDaysBefore?: number) => ({ id, title: 'Milad', date: new Date(`${date}T00:00:00.000Z`), time: '17:00', place: null, businessId: 'biz-1', business: { ownerId, owner: { notificationPrefs: eventDaysBefore ? { eventDaysBefore } : null } } });
    prisma.socialEvent.findMany.mockResolvedValueOnce([event('ev3', '2026-11-06', 'u1'), event('ev4', '2026-11-08', 'u1'), event('ev5', '2026-11-08', 'u2', 3)] as never);
    await service.sendReminders(new Date('2026-11-05T04:00:00.000Z'));
    // A day before by default; three days before for the owner who asked.
    expect(prisma.userNotification.createManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({ data: [expect.objectContaining({ userId: 'u1', type: 'EVENT', key: 'event:ev3:2026-11-06' }), expect.objectContaining({ userId: 'u2', key: 'event:ev5:2026-11-08' })], skipDuplicates: true }),
    );
  });
});
