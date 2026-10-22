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
    expect(prisma.habitMonthTracker.deleteMany).toHaveBeenCalledWith({ where: { id: 'trk-1', userId: 'user-1', checks: { none: {} }, paraLogs: { none: {} } } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each(['Namaz', 'Ramadan'] as const)('deletes an empty %s sheet', async (category) => {
    const { service, prisma } = setup({ tracker: sheet(category) });
    await expect(service.remove('user-1', 'trk-1')).resolves.toEqual({ id: 'trk-1' });
    expect(prisma.habitMonthTracker.deleteMany).toHaveBeenCalledWith({ where: { id: 'trk-1', userId: 'user-1', checks: { none: {} }, paraLogs: { none: {} } } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("is a 404 for another user's sheet", async () => {
    const { service, prisma } = setup({ tracker: sheet('Namaz', 'user-2') });
    await expect(service.remove('user-1', 'trk-1')).rejects.toThrow(NotFoundException);
    expect(prisma.habitMonthTracker.deleteMany).not.toHaveBeenCalled();
  });
});
