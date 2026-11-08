import { BadRequestException, NotFoundException } from '@nestjs/common';
import { HabitTrackersService, NAMAZ_PRAYERS } from './habit-trackers.service.js';

const sheet = (category: 'Namaz' | 'Ramadan' | 'Others', userId = 'user-1') => ({
  id: 'trk-1',
  userId,
  category,
  month: category === 'Others' ? null : category === 'Ramadan' ? 9 : 10,
  year: category === 'Others' ? null : 2026,
  name: category === 'Others' ? 'No Sugar' : null,
  totalDays: category === 'Namaz' ? null : 30,
  items: category === 'Namaz' ? NAMAZ_PRAYERS : category === 'Ramadan' ? ['Roza', 'Quran'] : ['No sugar', 'Walk'],
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
});

const REFUSAL = 'This tracker has ticks or paras logged -- clear them all before deleting it';

// `deleted`: how many sheets the final delete matches -- 0 is a Namaz or
// Ramadan sheet with ticks, or a challenge another request already deleted.
const setup = ({ tracker = sheet('Others') as ReturnType<typeof sheet> | null, deleted = 1 } = {}) => {
  const tx = {
    habitMonthCheck: { deleteMany: vi.fn().mockResolvedValue({ count: 12 }) },
    ramadanParaLog: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    habitMonthTracker: { deleteMany: vi.fn().mockResolvedValue({ count: deleted }) },
    reminder: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  const prisma = {
    habitMonthTracker: { findUnique: vi.fn().mockResolvedValue(tracker), deleteMany: vi.fn().mockResolvedValue({ count: deleted }) },
    habitMonthCheck: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    $transaction: vi.fn((work: (client: typeof tx) => unknown) => work(tx)),
  };
  return { service: new HabitTrackersService(prisma as never), prisma, tx };
};

describe('HabitTrackersService.remove: an Others challenge', () => {
  it('goes with every tick on it, in one transaction', async () => {
    const { service, prisma, tx } = setup();
    await expect(service.remove('user-1', 'trk-1')).resolves.toEqual({ id: 'trk-1' });

    expect(prisma.habitMonthTracker.findUnique).toHaveBeenCalledWith({ where: { id: 'trk-1' } });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.habitMonthCheck.deleteMany).toHaveBeenCalledWith({ where: { trackerId: 'trk-1' } });
    expect(tx.ramadanParaLog.deleteMany).toHaveBeenCalledWith({ where: { trackerId: 'trk-1' } });
    // The sheet (and its `items` with it), still matched on its owner.
    expect(tx.habitMonthTracker.deleteMany).toHaveBeenCalledWith({ where: { id: 'trk-1', userId: 'user-1', category: 'Others' } });
    // The ticks go before the sheet they hang off.
    expect(tx.habitMonthCheck.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(tx.habitMonthTracker.deleteMany.mock.invocationCallOrder[0]);
    // Its reminders too (Reminder.targetKey is no foreign key).
    expect(tx.reminder.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1', kind: 'CHALLENGE', targetKey: 'trk-1' } });
    // Nothing outside the transaction, and no "clear your ticks first".
    expect(prisma.habitMonthCheck.deleteMany).not.toHaveBeenCalled();
    expect(prisma.habitMonthTracker.deleteMany).not.toHaveBeenCalled();
  });

  it("is a 404 for another user's challenge, and deletes nothing", async () => {
    const { service, prisma } = setup({ tracker: sheet('Others', 'user-2') });
    await expect(service.remove('user-1', 'trk-1')).rejects.toThrow(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.habitMonthCheck.deleteMany).not.toHaveBeenCalled();
    expect(prisma.habitMonthTracker.deleteMany).not.toHaveBeenCalled();
  });

  it('is a 404 for a tracker that does not exist', async () => {
    const { service, prisma } = setup({ tracker: null });
    await expect(service.remove('user-1', 'trk-1')).rejects.toThrow(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('is a 404 thrown inside the transaction, so it rolls back, when another request deleted it first', async () => {
    const { service, prisma } = setup({ deleted: 0 });
    await expect(service.remove('user-1', 'trk-1')).rejects.toThrow(NotFoundException);
    await expect(prisma.$transaction.mock.results[0].value).rejects.toThrow(NotFoundException);
  });
});

describe('HabitTrackersService.remove: Namaz and Ramadan sheets, as before', () => {
  it.each(['Namaz', 'Ramadan'] as const)('refuses a %s sheet with ticks or paras', async (category) => {
    const { service, prisma } = setup({ tracker: sheet(category), deleted: 0 });
    const removing = service.remove('user-1', 'trk-1');
    await expect(removing).rejects.toBeInstanceOf(BadRequestException);
    await expect(removing).rejects.toThrow(REFUSAL);

    // Only the orphan ticks are cleared, and the delete stays conditional.
    expect(prisma.habitMonthCheck.deleteMany).toHaveBeenCalledWith({ where: { trackerId: 'trk-1', item: { notIn: sheet(category).items } } });
    expect(prisma.habitMonthTracker.deleteMany).toHaveBeenCalledWith({
      where: { id: 'trk-1', userId: 'user-1', checks: { none: {} }, paraLogs: { none: {} } },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each(['Namaz', 'Ramadan'] as const)('deletes an empty %s sheet', async (category) => {
    const { service, prisma } = setup({ tracker: sheet(category) });
    await expect(service.remove('user-1', 'trk-1')).resolves.toEqual({ id: 'trk-1' });
    expect(prisma.habitMonthTracker.deleteMany).toHaveBeenCalledWith({
      where: { id: 'trk-1', userId: 'user-1', checks: { none: {} }, paraLogs: { none: {} } },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("is a 404 for another user's sheet", async () => {
    const { service, prisma } = setup({ tracker: sheet('Namaz', 'user-2') });
    await expect(service.remove('user-1', 'trk-1')).rejects.toThrow(NotFoundException);
    expect(prisma.habitMonthTracker.deleteMany).not.toHaveBeenCalled();
  });
});

describe('HabitTrackersService: made-up fasts and the Get ready list', () => {
  const setupRamadan = (category: 'Namaz' | 'Ramadan' = 'Ramadan') => {
    const tracker = { ...sheet(category), fastsMadeUp: 0, checks: [], paraLogs: [] };
    const prisma = {
      habitMonthTracker: {
        findUnique: vi.fn().mockResolvedValue(tracker),
        findFirst: vi.fn().mockResolvedValue(tracker),
        update: vi.fn().mockResolvedValue(tracker),
      },
      ramadanPrep: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() },
    };
    return { service: new HabitTrackersService(prisma as never), prisma };
  };

  it('keeps made-up fasts on a Ramadan sheet only, never more than its days', async () => {
    const { service, prisma } = setupRamadan();
    await service.setFastsMadeUp('user-1', 'trk-1', 2);
    expect(prisma.habitMonthTracker.update).toHaveBeenCalledWith({ where: { id: 'trk-1' }, data: { fastsMadeUp: 2 } });
    await expect(service.setFastsMadeUp('user-1', 'trk-1', 31)).rejects.toThrow('At most 30 fasts');
    await expect(setupRamadan('Namaz').service.setFastsMadeUp('user-1', 'trk-1', 1)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps a goal on a Namaz month only, and shows it on Namaz alone', async () => {
    const { service, prisma } = setupRamadan('Namaz');
    prisma.habitMonthTracker.findUnique.mockResolvedValue({ ...sheet('Namaz'), fastsMadeUp: 0, checks: [], paraLogs: [], goalPct: 90 });
    await expect(service.setGoal('user-1', 'trk-1', 90)).resolves.toMatchObject({ goalPct: 90 });
    expect(prisma.habitMonthTracker.update).toHaveBeenCalledWith({ where: { id: 'trk-1' }, data: { goalPct: 90 } });
    await service.setGoal('user-1', 'trk-1', null);
    expect(prisma.habitMonthTracker.update).toHaveBeenLastCalledWith({ where: { id: 'trk-1' }, data: { goalPct: null } });
    await expect(setupRamadan('Ramadan').service.setGoal('user-1', 'trk-1', 50)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reads an empty list before any tick, and keeps each step once', async () => {
    const { service, prisma } = setupRamadan();
    await expect(service.getRamadanPrep('user-1', 2027)).resolves.toEqual({ year: 2027, items: [] });
    await expect(service.saveRamadanPrep('user-1', 2027, ['quran', 'quran', 'intention'])).resolves.toEqual({ year: 2027, items: ['quran', 'intention'] });
    expect(prisma.ramadanPrep.upsert.mock.calls[0][0].create).toEqual({ userId: 'user-1', year: 2027, items: ['quran', 'intention'] });
  });
});

describe('HabitTrackersService: a challenge starts, ends early and restarts', () => {
  // 02:00 on 4 November in Dhaka (still 3 November in UTC).
  beforeEach(() => vi.useFakeTimers({ now: new Date('2026-11-03T20:00:00.000Z') }));
  afterEach(() => vi.useRealTimers());

  const challenge = (more: { startsOn?: string; endedOnDay?: number | null; category?: 'Others' | 'Ramadan' } = {}) => ({
    ...sheet(more.category ?? 'Others'),
    startsOn: new Date(`${more.startsOn ?? '2026-11-01'}T00:00:00.000Z`),
    endedOnDay: more.endedOnDay ?? null,
    fastsMadeUp: 0,
    checks: [],
    paraLogs: [],
  });
  const setupChallenge = (tracker = challenge()) => {
    const prisma = {
      habitMonthTracker: {
        findUnique: vi.fn().mockResolvedValue(tracker),
        findFirst: vi.fn().mockResolvedValue(tracker),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockReturnValue('update'),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue(tracker),
      },
      habitMonthCheck: { deleteMany: vi.fn().mockReturnValue('clear'), createMany: vi.fn() },
      $executeRaw: vi.fn(),
      $transaction: vi.fn((work: unknown) => (typeof work === 'function' ? work(prisma) : Promise.all(work as unknown[]))),
    };
    return { service: new HabitTrackersService(prisma as never), prisma };
  };

  it('starts on the Dhaka day it is made, or the day after', async () => {
    const { service, prisma } = setupChallenge();
    await service.createCustom('user-1', { name: 'No Sugar', totalDays: 21 });
    expect(prisma.habitMonthTracker.create.mock.calls[0][0].data.startsOn).toEqual(new Date('2026-11-04T00:00:00.000Z'));
    await service.createCustom('user-1', { name: 'No Sugar', totalDays: 21, startsTomorrow: true });
    expect(prisma.habitMonthTracker.create.mock.calls[1][0].data.startsOn).toEqual(new Date('2026-11-05T00:00:00.000Z'));
  });

  it('ends on the day it has reached, once', async () => {
    const { service, prisma } = setupChallenge();
    const view = await service.endChallenge('user-1', 'trk-1');
    expect(prisma.habitMonthTracker.updateMany).toHaveBeenCalledWith({ where: { id: 'trk-1', endedOnDay: null }, data: { endedOnDay: 4 } });
    expect(view.startsOn).toBe('2026-11-01');
    await expect(setupChallenge(challenge({ endedOnDay: 2 })).service.endChallenge('user-1', 'trk-1')).rejects.toThrow('already ended');
    await expect(setupChallenge(challenge({ startsOn: '2026-11-05' })).service.endChallenge('user-1', 'trk-1')).rejects.toThrow("hasn't begun");
    await expect(setupChallenge(challenge({ startsOn: '2026-09-01' })).service.endChallenge('user-1', 'trk-1')).rejects.toThrow('already over');
    await expect(setupChallenge(challenge({ category: 'Ramadan' })).service.endChallenge('user-1', 'trk-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('restarts from today with its ticks cleared', async () => {
    const { service, prisma } = setupChallenge(challenge({ endedOnDay: 3 }));
    await service.restartChallenge('user-1', 'trk-1');
    expect(prisma.habitMonthCheck.deleteMany).toHaveBeenCalledWith({ where: { trackerId: 'trk-1' } });
    expect(prisma.habitMonthTracker.update).toHaveBeenCalledWith({
      where: { id: 'trk-1' },
      data: { startsOn: new Date('2026-11-04T00:00:00.000Z'), endedOnDay: null },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(['clear', 'update']);
  });

  it('takes no tick after the day it was ended, but can still clear one', async () => {
    const { service, prisma } = setupChallenge(challenge({ endedOnDay: 3 }));
    await expect(service.setCheck('user-1', 'trk-1', { day: 4, item: 'Walk', checked: true })).rejects.toThrow('ended on day 3');
    await service.setCheck('user-1', 'trk-1', { day: 3, item: 'Walk', checked: true });
    expect(prisma.habitMonthCheck.createMany).toHaveBeenCalledTimes(1);
    await service.setCheck('user-1', 'trk-1', { day: 4, item: 'Walk', checked: false });
    expect(prisma.habitMonthCheck.deleteMany).toHaveBeenCalledWith({ where: { trackerId: 'trk-1', day: 4, item: 'Walk' } });
  });

  it('reads an older challenge from the UTC date it was created', async () => {
    const { service } = setupChallenge({ ...challenge(), startsOn: null as never, createdAt: new Date('2026-10-30T22:00:00.000Z') });
    await expect(service.endChallenge('user-1', 'trk-1')).resolves.toMatchObject({ startsOn: '2026-10-30' });
  });
});
