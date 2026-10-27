import { type ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerLimitDetail,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service.js';
import { rateLimitEntry, shouldLogBlock, type ThrottledRequest } from './rate-limit-log.js';

// One row per endpoint and caller per minute, however hard a flood hits.
const LOG_EVERY_MS = 60 * 1000;

// The app's throttler (APP_GUARD), which also keeps a history of refusals:
// each 429 writes an ApiRateLimitLog row for System > Rate limits. The
// write is best-effort and in the background -- the 429 goes out whatever
// happens to it -- and the ThrottlerException is rethrown unchanged, so the
// sign-in routes' LoginRateLimitFilter still catches it.
@Injectable()
export class LoggingThrottlerGuard extends ThrottlerGuard {
  private readonly logger = new Logger(LoggingThrottlerGuard.name);
  private readonly lastLogged = new Map<string, number>();

  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {
    super(options, storageService, reflector);
  }

  protected override async throwThrottlingException(context: ExecutionContext, detail: ThrottlerLimitDetail): Promise<void> {
    try {
      const req = context.switchToHttp().getRequest<ThrottledRequest>();
      const entry = rateLimitEntry(req, detail, Date.now());
      if (shouldLogBlock(this.lastLogged, `${entry.endpoint}|${entry.identifierType}|${entry.identifier}`, Date.now(), LOG_EVERY_MS)) {
        void this.prisma.apiRateLimitLog.create({ data: entry, select: { id: true } }).catch((error: unknown) => {
          this.logger.warn(`Could not log a rate-limit block: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    } catch {
      // Logging must never change the answer.
    }
    return super.throwThrottlingException(context, detail);
  }
}
