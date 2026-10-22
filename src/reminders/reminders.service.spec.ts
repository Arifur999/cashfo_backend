import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { UpsertReminderDto } from './dto/reminder.dto.js';
import { RemindersService } from './reminders.service.js';

const saved = (fields: object) => ({
  id: 'r1',
  userId: 'u1',
  createdAt: new Date(),
  updatedAt: new Date(),
  minutesBefore: 0,
  times: [],
  weekdays: [],
  ...fields,
});

const setup = ({ habit = { id: 'h1' } as object | null, existing = null as object | null } = {}) => {
  const prisma = {
    habit: { findFirst: vi.fn().mockResolvedValue(habit) },
    habitMonthTracker: { findFirst: vi.fn().mockResolvedValue(null) },
    book: { findFirst: vi.fn().mockResolvedValue(null) },
    skill: { findFirst: vi.fn().mockResolvedValue(null) },
    reminder: {
      findUnique: vi.fn().mockResolvedValue(existing),
      upsert: vi.fn(({ create }: { where: unknown; create: object }) => Promise.resolve(saved(create))),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  return { service: new RemindersService(prisma as never), prisma };
};

const dto = (fields: Partial<UpsertReminderDto>): UpsertReminderDto => ({ kind: 'HABIT', targetKey: 'h1', enabled: true, ...fields });

describe('RemindersService.upsert', () => {
  it("saves a habit's times sorted, by (user, kind, target)", async () => {
    const { service, prisma } = setup();
    const view = await service.upsert('u1', dto({ times: ['21:00', '07:30'], weekdays: [5, 0] }));
    expect(view).toMatchObject({ kind: 'HABIT', targetKey: 'h1', enabled: true, times: ['07:30', '21:00'], weekdays: [0, 5] });
    expect(view).not.toHaveProperty('userId');
    expect(prisma.habit.findFirst).toHaveBeenCalledWith({ where: { id: 'h1', userId: 'u1', isArchived: false }, select: { id: true } });
    expect(prisma.reminder.upsert.mock.calls[0][0].where).toEqual({ userId_kind_targetKey: { userId: 'u1', kind: 'HABIT', targetKey: 'h1' } });
  });

  it('keeps the saved times when only the switch changes', async () => {
    const { service } = setup({ existing: saved({ times: ['06:00'], weekdays: [1] }) });
    await expect(service.upsert('u1', dto({ enabled: false }))).resolves.toMatchObject({ enabled: false, times: ['06:00'], weekdays: [1] });
  });

  it('needs a time to be on', async () => {
    const { service } = setup();
    await expect(service.upsert('u1', dto({}))).rejects.toThrow(BadRequestException);
    await expect(service.upsert('u1', dto({ times: [] }))).rejects.toThrow(BadRequestException);
  });

  it("is a 404 for a habit that isn't the caller's", async () => {
    const { service, prisma } = setup({ habit: null });
    await expect(service.upsert('u1', dto({ times: ['07:00'] }))).rejects.toThrow(NotFoundException);
    expect(prisma.reminder.upsert).not.toHaveBeenCalled();
    await expect(service.upsert('u1', dto({ kind: 'BOOK', targetKey: 'b1', times: ['07:00'] }))).rejects.toThrow(NotFoundException);
  });

  it('takes the five prayers, Sehri and Iftar by name, with no clock of their own', async () => {
    const { service } = setup();
    await expect(service.upsert('u1', dto({ kind: 'NAMAZ', targetKey: 'fajr', minutesBefore: 10, times: ['07:00'] }))).resolves.toMatchObject({
      kind: 'NAMAZ',
      targetKey: 'fajr',
      minutesBefore: 10,
      times: [],
      weekdays: [],
    });
    await expect(service.upsert('u1', dto({ kind: 'NAMAZ', targetKey: 'tahajjud' }))).rejects.toThrow(BadRequestException);
    await expect(service.upsert('u1', dto({ kind: 'RAMADAN', targetKey: 'iftar' }))).resolves.toMatchObject({ targetKey: 'iftar' });
    await expect(service.upsert('u1', dto({ kind: 'RAMADAN', targetKey: 'fajr' }))).rejects.toThrow(BadRequestException);
  });

  it("sends to-dos to the task's own remindBefore", async () => {
    const { service } = setup();
    await expect(service.upsert('u1', dto({ kind: 'TODO', targetKey: 'i1' }))).rejects.toThrow(BadRequestException);
  });
});

describe('RemindersService.remove', () => {
  it("deletes only the caller's own", async () => {
    const { service, prisma } = setup();
    await expect(service.remove('u1', 'r1')).resolves.toEqual({ ok: true });
    expect(prisma.reminder.deleteMany).toHaveBeenCalledWith({ where: { id: 'r1', userId: 'u1' } });
    prisma.reminder.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.remove('u1', 'r2')).rejects.toThrow(NotFoundException);
  });
});
