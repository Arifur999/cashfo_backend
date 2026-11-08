import { describe, expect, it, vi } from 'vitest';
import { SkillsService } from './skills.service.js';

const skill = (more: Record<string, unknown> = {}) => ({
  id: 's1',
  userId: 'u1',
  name: 'React',
  source: '',
  unit: 'LESSONS',
  target: 40,
  progress: 18,
  loggedProgress: 18,
  status: 'LEARNING',
  color: 'violet',
  icon: 'code',
  category: 'tech',
  link: '',
  why: '',
  targetDate: null,
  pausedAt: new Date('2026-11-01T00:00:00.000Z'),
  base: 4,
  deletedAt: null,
  startedAt: new Date('2026-09-28T06:00:00.000Z'),
  completedAt: null,
  createdAt: new Date('2026-09-28T06:00:00.000Z'),
  updatedAt: new Date('2026-11-01T00:00:00.000Z'),
  ...more,
});

// A transaction client whose skill row is `row`, with `logged` already logged
// and `existing` on the day being written.
const setup = (row: ReturnType<typeof skill>, logged: number, existing: number | null) => {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: row.id }]),
    skill: { findUniqueOrThrow: vi.fn().mockResolvedValue(row), update: vi.fn().mockImplementation(({ data }) => ({ ...row, ...data })) },
    skillLog: {
      findUnique: vi.fn().mockResolvedValue(existing === null ? null : { amount: existing }),
      aggregate: vi.fn().mockResolvedValue({ _sum: { amount: logged } }),
      upsert: vi.fn().mockImplementation(({ create }) => ({ ...create, note: create.note })),
    },
  };
  const prisma = { $transaction: vi.fn().mockImplementation((fn: (client: typeof tx) => unknown) => fn(tx)) };
  return { service: new SkillsService(prisma as never), tx };
};

describe('SkillsService.logPractice', () => {
  it('writes a day, takes a paused skill up again and moves the progress', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-08T08:00:00.000Z') });
    const { service, tx } = setup(skill(), 14, null);
    const { skill: saved, entry } = await service.logPractice('u1', 's1', '2026-11-08', { amount: 2, note: '  Routing\r\n ' });
    expect(entry).toEqual({ date: '2026-11-08', amount: 2, note: 'Routing' });
    expect(tx.skill.update.mock.calls[0][0].data).toMatchObject({ status: 'LEARNING', pausedAt: null, progress: 20 });
    expect(saved.progress).toBe(20);
    vi.useRealTimers();
  });

  it('rewrites a day already logged without counting it twice', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-08T08:00:00.000Z') });
    const { service, tx } = setup(skill(), 14, 3);
    await service.logPractice('u1', 's1', '2026-11-08', { amount: 1 });
    expect(tx.skill.update.mock.calls[0][0].data.progress).toBe(16);
    vi.useRealTimers();
  });

  it('completes the skill at its end unless asked not to', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-08T08:00:00.000Z') });
    const done = setup(skill(), 34, null);
    await done.service.logPractice('u1', 's1', '2026-11-07', { amount: 2 });
    expect(done.tx.skill.update.mock.calls[0][0].data).toMatchObject({ status: 'COMPLETED', completedAt: new Date('2026-11-07T06:00:00.000Z'), progress: 40 });
    const notYet = setup(skill(), 34, null);
    await notYet.service.logPractice('u1', 's1', '2026-11-08', { amount: 2, finish: false });
    expect(notYet.tx.skill.update.mock.calls[0][0].data).toMatchObject({ status: 'LEARNING', completedAt: null, progress: 40 });
    vi.useRealTimers();
  });

  it('refuses a day before the start, one to come, and lessons past the end', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-08T08:00:00.000Z') });
    await expect(setup(skill(), 14, null).service.logPractice('u1', 's1', '2026-09-01', { amount: 1 })).rejects.toThrow(
      'You started this skill on 2026-09-28. Pick that day or later',
    );
    await expect(setup(skill(), 14, null).service.logPractice('u1', 's1', '2026-11-09', { amount: 1 })).rejects.toThrow("The date can't be in the future");
    await expect(setup(skill(), 34, null).service.logPractice('u1', 's1', '2026-11-08', { amount: 3 })).rejects.toThrow(
      'Only 2 lessons are left in this skill',
    );
    vi.useRealTimers();
  });

  it('starts a skill not started on the day practised', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-08T08:00:00.000Z') });
    const { service, tx } = setup(skill({ status: 'WANT_TO_LEARN', startedAt: null, pausedAt: null, base: 0 }), 0, null);
    await service.logPractice('u1', 's1', '2026-11-06', { amount: 1 });
    expect(tx.skill.update.mock.calls[0][0].data).toMatchObject({ status: 'LEARNING', startedAt: new Date('2026-11-06T06:00:00.000Z'), progress: 1 });
    vi.useRealTimers();
  });
});

describe('SkillsService.update', () => {
  it('works the progress out again from what is logged, and keeps the unit once practice is logged', async () => {
    const row = skill();
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: row.id }]),
      skill: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(row),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockImplementation(({ data }) => ({ ...row, ...data })),
      },
      skillLog: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 14 } }), count: vi.fn().mockResolvedValue(13) },
    };
    const service = new SkillsService({ $transaction: vi.fn().mockImplementation((fn: (client: typeof tx) => unknown) => fn(tx)) } as never);
    await expect(service.update('u1', 's1', { target: 30, base: 10 })).resolves.toMatchObject({ target: 30, base: 10, progress: 24 });
    // The older "I'm on lesson 20" moves what came before.
    await expect(service.update('u1', 's1', { progress: 20 })).resolves.toMatchObject({ base: 6, progress: 20 });
    await expect(service.update('u1', 's1', { unit: 'HOURS' })).rejects.toThrow('Practice is already logged, so the unit can not change');
    await expect(service.update('u1', 's1', { base: 41 })).rejects.toThrow("What is already done can't be more than the total");
  });
});
