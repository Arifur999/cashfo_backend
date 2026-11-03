import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { JournalService } from './journal.service.js';
import { NotesService } from './notes.service.js';

// Noon in Dhaka on Friday 2 October 2026.
const NOW = new Date('2026-10-02T06:00:00.000Z');
const USER = { id: 'user-1', sessionId: 'session-1' } as never;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

const entry = (date: string, extra: Record<string, unknown> = {}) => ({
  date: new Date(`${date}T00:00:00.000Z`),
  kind: 'DAILY',
  mood: 1,
  wentWell: 'Walked after Fajr',
  gratefulFor: '',
  tomorrow: '',
  body: '',
  categoryId: null,
  tags: [],
  isPrivate: false,
  updatedAt: NOW,
  ...extra,
});

const status = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) return { status: error.getStatus(), body: error.getResponse() as Record<string, unknown> };
    throw error;
  }
  throw new Error('expected a refusal');
};

describe('NotesService', () => {
  const setup = (settings: unknown = null) => {
    const prisma = {
      writingSettings: { findUnique: vi.fn().mockResolvedValue(settings), create: vi.fn().mockReturnValue('create-settings') },
      noteCategory: {
        createMany: vi.fn().mockReturnValue('create-categories'),
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
        deleteMany: vi.fn(),
      },
      note: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn(),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: vi.fn().mockResolvedValue([]),
      user: { findUnique: vi.fn().mockResolvedValue({ preferredLanguage: 'EN' }) },
    };
    return { service: new NotesService(prisma as never), prisma };
  };

  it('adds the starter categories on the first visit only', async () => {
    const first = setup(null);
    await first.service.overview('user-1');
    expect(first.prisma.$transaction).toHaveBeenCalledWith(['create-settings', 'create-categories']);
    expect(first.prisma.noteCategory.createMany.mock.calls[0][0].data.map((c: { name: string }) => c.name)).toEqual([
      'Work',
      'Family',
      'Business',
      'Study',
      'Personal',
    ]);

    const bangla = setup(null);
    bangla.prisma.user.findUnique.mockResolvedValue({ preferredLanguage: 'BN' });
    await bangla.service.start('user-1');
    expect(bangla.prisma.noteCategory.createMany.mock.calls[0][0].data[0]).toEqual({ userId: 'user-1', name: 'কাজ', color: 'blue' });

    const later = setup({ id: 'settings-1' });
    await later.service.overview('user-1');
    expect(later.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('lets a second first visit lose the race quietly', async () => {
    const { service, prisma } = setup(null);
    prisma.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' }));
    await expect(service.start('user-1')).resolves.toBeUndefined();
  });

  it('refuses a category that is not the person own', async () => {
    const { service, prisma } = setup({ id: 'settings-1' });
    expect((await status(service.create('user-1', { body: 'Call the courier', categoryId: 'other-users' }))).status).toBe(404);
    expect(prisma.note.create).not.toHaveBeenCalled();
  });

  it('stores tags lowercase and once each', async () => {
    const { service, prisma } = setup({ id: 'settings-1' });
    await service.create('user-1', { body: 'Bazar list', tags: ['Shopping', 'shopping', 'family'] });
    expect(prisma.note.create.mock.calls[0][0].data).toMatchObject({ kind: 'NOTE', title: '', tags: ['shopping', 'family'], color: 'white', pinned: false });
  });

  it('answers 404 for a note that is not there', async () => {
    const { service } = setup();
    expect((await status(service.remove('user-1', 'missing'))).status).toBe(404);
  });
});

describe('JournalService', () => {
  const setup = (
    options: { pinHash?: string | null; failures?: number; failedAt?: Date | null; rows?: unknown[]; existing?: unknown; unlocked?: boolean } = {},
  ) => {
    const settings =
      options.pinHash === undefined ? null : { diaryPinHash: options.pinHash, pinFailures: options.failures ?? 0, pinFailedAt: options.failedAt ?? null };
    const prisma = {
      writingSettings: {
        findUnique: vi.fn().mockResolvedValue(settings),
        findUniqueOrThrow: vi.fn().mockResolvedValue(settings ?? { diaryPinHash: null, pinFailures: 0, pinFailedAt: null }),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      journalEntry: {
        findMany: vi.fn().mockResolvedValue(options.rows ?? []),
        count: vi.fn().mockResolvedValue((options.rows ?? []).length),
        findUnique: vi.fn().mockResolvedValue(options.existing ?? null),
        upsert: vi.fn().mockImplementation(({ create }: { create: Record<string, unknown> }) => Promise.resolve({ ...entry('2026-10-02'), ...create })),
      },
      note: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const notes = { requireCategory: vi.fn(), start: vi.fn() };
    const unlocks = { opens: vi.fn().mockReturnValue(options.unlocked ?? false), issue: vi.fn().mockReturnValue({ unlockToken: 'unlock', expiresIn: 43200 }) };
    const credentials = { verify: vi.fn().mockResolvedValue(false), has: vi.fn().mockResolvedValue(true) };
    return { service: new JournalService(prisma as never, notes as never, unlocks as never, credentials as never), prisma, unlocks, credentials };
  };

  it('shows a private entry only once the diary is open', async () => {
    const rows = [entry('2026-10-01'), entry('2026-10-02', { isPrivate: true, mood: 3, body: 'Hard day' })];
    const locked = await setup({ pinHash: 'hash', rows }).service.month(USER, '2026-10', undefined);
    expect(locked.entries[1]).toEqual({ date: '2026-10-02', isPrivate: true, locked: true });
    expect(locked).toMatchObject({ pinSet: true, unlocked: false, streak: 2, total: 2 });

    const open = await setup({ pinHash: 'hash', rows, unlocked: true }).service.month(USER, '2026-10', 'token');
    expect(open.entries[1]).toMatchObject({ date: '2026-10-02', mood: 3, body: 'Hard day', locked: false });
  });

  it('searches private entries only while the diary is open', async () => {
    const { service, prisma } = setup({ pinHash: 'hash' });
    await service.search(USER, '#Smartly', undefined);
    const where = prisma.journalEntry.findMany.mock.calls[0][0].where;
    expect(where.isPrivate).toBe(false);
    expect(where.OR).toContainEqual({ tags: { has: 'smartly' } });
  });

  it('writes today or an earlier day, never a later one', async () => {
    const { service } = setup();
    expect((await status(service.save(USER, '2026-10-03', { kind: 'DAILY', mood: 1 }, undefined))).status).toBe(400);
    expect((await status(service.save(USER, '2026-02-30', { kind: 'DAILY', mood: 1 }, undefined))).status).toBe(400);
  });

  it('never overwrites a private entry unseen', async () => {
    const { service, prisma } = setup({ pinHash: 'hash', existing: { isPrivate: true } });
    const refused = await status(service.save(USER, '2026-10-02', { kind: 'DAILY', mood: 1 }, undefined));
    expect(refused).toMatchObject({ status: 423, body: { reason: 'JOURNAL_LOCKED' } });
    expect(prisma.journalEntry.upsert).not.toHaveBeenCalled();
  });

  it('turns an entry private only once a PIN exists', async () => {
    const { service } = setup();
    expect(await status(service.save(USER, '2026-10-02', { kind: 'DIARY', mood: 1, isPrivate: true }, undefined))).toMatchObject({
      status: 409,
      body: { reason: 'PIN_REQUIRED' },
    });
  });

  it('keeps no prompts on a diary page, and reads its #tags', async () => {
    const { service, prisma } = setup();
    await service.save(USER, '2026-10-02', { kind: 'DIARY', mood: 2, wentWell: 'hidden', body: ' Long talk with Abbu. #family #Land ' }, undefined);
    expect(prisma.journalEntry.upsert.mock.calls[0][0].create).toMatchObject({
      kind: 'DIARY',
      wentWell: '',
      body: 'Long talk with Abbu. #family #Land',
      tags: ['family', 'land'],
      isPrivate: false,
    });
  });

  it('counts a wrong PIN and says how many tries are left', async () => {
    const pinHash = await bcrypt.hash('1234', 4);
    const { service, prisma } = setup({ pinHash });
    prisma.writingSettings.findUniqueOrThrow.mockResolvedValue({ pinFailures: 1, pinFailedAt: NOW });
    expect(await status(service.unlock(USER, '9999'))).toMatchObject({ status: 401, body: { reason: 'PIN_WRONG', triesLeft: 9 } });
  });

  it('waits after ten wrong PINs, even for the right one', async () => {
    const pinHash = await bcrypt.hash('1234', 4);
    const { service, unlocks } = setup({ pinHash, failures: 10, failedAt: new Date(NOW.getTime() - 60_000) });
    expect(await status(service.unlock(USER, '1234'))).toMatchObject({ status: 429, body: { reason: 'TOO_MANY_TRIES', retryAfterSec: 540 } });
    expect(unlocks.issue).not.toHaveBeenCalled();
  });

  it('opens the diary with the right PIN and clears the wrong tries', async () => {
    const pinHash = await bcrypt.hash('1234', 4);
    const { service, prisma } = setup({ pinHash, failures: 2, failedAt: NOW });
    await expect(service.unlock(USER, '1234')).resolves.toEqual({ unlockToken: 'unlock', expiresIn: 43200 });
    expect(prisma.writingSettings.update).toHaveBeenCalledWith({ where: { userId: 'user-1' }, data: { pinFailures: 0, pinFailedAt: null } });
  });

  it('replaces a PIN only with the account password', async () => {
    const { service, prisma } = setup({ pinHash: 'old' });
    prisma.writingSettings.findUniqueOrThrow.mockResolvedValue({ diaryPinHash: 'old' });
    expect(await status(service.setPin(USER, { pin: '4321' }))).toMatchObject({ status: 400, body: { reason: 'PASSWORD_REQUIRED' } });
    expect(await status(service.setPin(USER, { pin: '4321', password: 'wrong' }))).toMatchObject({ status: 400, body: { reason: 'PASSWORD_WRONG' } });
    expect(prisma.writingSettings.update).not.toHaveBeenCalled();
  });

  it('sets a first PIN without a password, and opens the diary', async () => {
    const { service, prisma } = setup();
    await expect(service.setPin(USER, { pin: '4321' })).resolves.toMatchObject({ pinSet: true, unlockToken: 'unlock' });
    expect(prisma.writingSettings.update.mock.calls[0][0].data).toMatchObject({ pinFailures: 0, pinFailedAt: null });
  });
});
