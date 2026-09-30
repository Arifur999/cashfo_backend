import { ConflictException, Controller, ForbiddenException, Headers, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { exec } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { PrismaService } from '../prisma/prisma.service.js';

const execAsync = promisify(exec);

// Constant-time secret check: `!==` returns as soon as a character differs, so
// response timing could leak how much of a guess was right. Hashing both sides
// first gives equal-length buffers, as timingSafeEqual requires, without
// revealing the secret's length either.
function secretMatches(given: string | undefined, expected: string): boolean {
  if (given === undefined) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

// Set while a seed run is in progress, so two requests arriving together can't
// both pass the AdminUser count check below and run the seed side by side.
let seedRunning = false;

// TEMPORARY -- one-shot production bootstrap endpoint. Render's free Postgres
// plan has no Access Control UI for external connections and free web
// services have no Shell/One-Off Jobs access, so `npm run prisma:seed` can't
// be run against production from a local machine or via Render's dashboard.
// This route lets it run from inside Render's own network instead, using the
// already-configured internal DATABASE_URL. Guarded by a header secret and a
// count check so it can only ever actually seed once. Delete this whole
// module (and its app.module.ts registration + the SEED_TRIGGER_SECRET env
// var) once production has been seeded successfully.
@Controller('internal')
export class InternalController {
  constructor(private readonly prisma: PrismaService) {}

  // Far below the global 100/min: a real operator calls this once, so this
  // mainly slows down anyone trying to guess the secret.
  @Throttle({ default: { limit: 5, ttl: 15 * 60 * 1000 } })
  @Post('seed')
  async triggerSeed(@Headers('x-seed-secret') secret?: string) {
    const expected = process.env.SEED_TRIGGER_SECRET;
    if (!expected || !secretMatches(secret, expected)) {
      throw new ForbiddenException();
    }
    if (seedRunning) {
      throw new ConflictException('A seed run is already in progress.');
    }

    seedRunning = true;
    try {
      const alreadySeeded = await this.prisma.adminUser.count();
      if (alreadySeeded > 0) {
        throw new ConflictException('Database already has AdminUser rows -- refusing to seed again.');
      }

      const { stdout, stderr } = await execAsync('npm run prisma:seed', {
        cwd: process.cwd(),
        timeout: 5 * 60 * 1000,
        maxBuffer: 10 * 1024 * 1024,
      });

      return {
        success: true,
        stdout: stdout.slice(-4000),
        stderr: stderr.slice(-2000),
      };
    } finally {
      seedRunning = false;
    }
  }
}
