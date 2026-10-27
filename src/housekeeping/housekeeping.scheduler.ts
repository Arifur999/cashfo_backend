import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { dueJobs, housekeepingDisabled, TICK_MS, type HousekeepingJob } from './housekeeping.js';

// A tick holds its lock at most this long, so a stuck job can't keep the
// next tick (or another server) out for good.
const LOCK_HOLD_MS = TICK_MS - 30 * 1000;

// The app's second timer, beside RemindersScheduler: every five minutes it
// runs the tidy-up jobs other modules register (pending checkouts that
// lapsed, plans whose period ran out, ...). One tick at a time across every
// server: the tick takes a Postgres advisory lock for its whole run inside
// one transaction (pg_try_advisory_xact_lock, released when it ends), and
// a tick that can't get it skips -- another server, or an overlapping tick,
// is doing the work. Each job is idempotent and also runs lazily where its
// data is read, so a skipped or failed tick only delays the tidying.
//
// Off under NODE_ENV=test and with HOUSEKEEPING_DISABLED=1.
@Injectable()
export class HousekeepingScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(HousekeepingScheduler.name);
  private readonly jobs: HousekeepingJob[] = [];
  private readonly lastRun = new Map<string, number>();
  private interval?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  // Called by other modules in onModuleInit, before the first tick.
  register(job: HousekeepingJob) {
    if (this.jobs.some((existing) => existing.name === job.name)) throw new Error(`Housekeeping job "${job.name}" is registered twice`);
    this.jobs.push(job);
  }

  get registered(): readonly HousekeepingJob[] {
    return this.jobs;
  }

  onApplicationBootstrap() {
    if (housekeepingDisabled()) {
      this.logger.log('Housekeeping is off (NODE_ENV=test or HOUSEKEEPING_DISABLED=1)');
      return;
    }
    this.interval = setInterval(() => void this.tick(), TICK_MS);
    this.interval.unref();
  }

  onModuleDestroy() {
    clearInterval(this.interval);
  }

  async tick(now = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.prisma.$transaction(
        async (tx) => {
          const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext('housekeeping')) AS locked`;
          if (!locked) return;
          for (const job of dueJobs(this.jobs, this.lastRun, now.getTime())) {
            this.lastRun.set(job.name, now.getTime());
            try {
              await job.run(now);
            } catch (error) {
              this.logger.warn(`Housekeeping job ${job.name} failed: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
        },
        { maxWait: 10_000, timeout: LOCK_HOLD_MS },
      );
    } catch (error) {
      this.logger.warn(`Housekeeping tick failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
