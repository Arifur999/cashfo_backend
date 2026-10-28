import { dueJobs, housekeepingDisabled, TICK_MS, type HousekeepingJob } from './housekeeping.js';
import { HousekeepingScheduler } from './housekeeping.scheduler.js';

const job = (name: string, everyMs = TICK_MS, run = vi.fn().mockResolvedValue(undefined)): HousekeepingJob => ({ name, everyMs, run });

describe('dueJobs', () => {
  it('runs a job never run before, and again once its interval has passed', () => {
    const hourly = job('hourly', 60 * 60 * 1000);
    expect(dueJobs([hourly], new Map(), 0)).toEqual([hourly]);
    expect(dueJobs([hourly], new Map([['hourly', 0]]), 30 * 60 * 1000)).toEqual([]);
    expect(dueJobs([hourly], new Map([['hourly', 0]]), 60 * 60 * 1000)).toEqual([hourly]);
  });

  it('runs a five-minute job on every tick, even one that starts a moment early', () => {
    const tidy = job('tidy');
    expect(dueJobs([tidy], new Map([['tidy', 0]]), TICK_MS - 1000)).toEqual([tidy]);
  });
});

describe('housekeepingDisabled', () => {
  it('is off under tests and with HOUSEKEEPING_DISABLED=1', () => {
    expect(housekeepingDisabled({ NODE_ENV: 'test' })).toBe(true);
    expect(housekeepingDisabled({ NODE_ENV: 'production', HOUSEKEEPING_DISABLED: '1' })).toBe(true);
    expect(housekeepingDisabled({ NODE_ENV: 'production' })).toBe(false);
  });
});

describe('HousekeepingScheduler.tick', () => {
  const setup = (locked: boolean) => {
    const tx = { $queryRaw: vi.fn().mockResolvedValue([{ locked }]) };
    const prisma = { $transaction: vi.fn((run: (client: typeof tx) => Promise<void>) => run(tx)) };
    return { scheduler: new HousekeepingScheduler(prisma as never), tx };
  };

  it('runs every due job under the lock, and a failing job costs only itself', async () => {
    const { scheduler } = setup(true);
    const broken = job('broken', TICK_MS, vi.fn().mockRejectedValue(new Error('boom')));
    const fine = job('fine');
    scheduler.register(broken);
    scheduler.register(fine);

    await scheduler.tick(new Date(0));

    expect(broken.run).toHaveBeenCalledTimes(1);
    expect(fine.run).toHaveBeenCalledWith(new Date(0));
  });

  it('skips the whole tick when another server holds the lock', async () => {
    const { scheduler } = setup(false);
    const fine = job('fine');
    scheduler.register(fine);

    await scheduler.tick(new Date(0));

    expect(fine.run).not.toHaveBeenCalled();
  });

  it('refuses the same job name twice', () => {
    const { scheduler } = setup(true);
    scheduler.register(job('once'));
    expect(() => scheduler.register(job('once'))).toThrow(/twice/);
  });
});
