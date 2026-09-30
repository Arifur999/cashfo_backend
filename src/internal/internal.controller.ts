import { ConflictException, Controller, ForbiddenException, Headers, Post } from '@nestjs/common';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { PrismaService } from '../prisma/prisma.service.js';

const execAsync = promisify(exec);

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

  @Post('seed')
  async triggerSeed(@Headers('x-seed-secret') secret?: string) {
    const expected = process.env.SEED_TRIGGER_SECRET;
    if (!expected || secret !== expected) {
      throw new ForbiddenException();
    }

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
  }
}
