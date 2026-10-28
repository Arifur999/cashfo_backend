// One tidy-up job the housekeeping timer runs. Every job must also be safe
// to run lazily on read: the read path stays the source of truth (a
// customer's billing page expires their own checkout when it opens), and
// the timer only catches up on everyone else.
export interface HousekeepingJob {
  // Unique, for the logs and the schedule ("billing-pending-expiry").
  name: string;
  // At most this often; the timer ticks every TICK_MS, so anything shorter
  // runs once a tick.
  everyMs: number;
  run(now: Date): Promise<void>;
}

export const TICK_MS = 5 * 60 * 1000;

// The jobs that are due at `now`: never run, or last run at least everyMs
// ago. A little slack (a tenth of a tick) lets a 5-minute job run on every
// 5-minute tick even when a tick starts a moment early.
export function dueJobs(jobs: HousekeepingJob[], lastRun: ReadonlyMap<string, number>, now: number): HousekeepingJob[] {
  const slack = TICK_MS / 10;
  return jobs.filter((job) => {
    const last = lastRun.get(job.name);
    return last === undefined || now - last >= job.everyMs - slack;
  });
}

export function housekeepingDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'test' || env.HOUSEKEEPING_DISABLED === '1';
}
