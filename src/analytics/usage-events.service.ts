import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { placeOfIp } from '../common/ip-country.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { classifyDeviceType, firstWithin, type UsageEventType } from './usage-events.js';

// One look at a report page reads several report endpoints (and the
// dashboard reads two of them), so a view counts once per customer, report
// and half hour rather than once per request.
const DEDUPE_MS = 30 * 60 * 1000;

interface ClientSignal {
  userAgent?: string | null;
  ipAddress?: string | null;
}

// UsageEvent rows the server writes for a few customer actions that leave no
// other trace (viewing a report) or that Analytics counts as an action of
// its own (a habit check-in). Fire-and-forget: a failed write is logged and
// never reaches the request that caused it.
@Injectable()
export class UsageEventsService {
  private readonly logger = new Logger(UsageEventsService.name);
  private readonly recent = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  // dedupeKey: count the event at most once per customer and key in
  // DEDUPE_MS (in this server's memory, so a restart may count one more).
  record(userId: string, eventType: UsageEventType, metadata?: Record<string, unknown>, client: ClientSignal = {}, dedupeKey?: string): void {
    if (dedupeKey !== undefined && !firstWithin(this.recent, `${userId}|${eventType}|${dedupeKey}`, Date.now(), DEDUPE_MS)) return;
    const data: Prisma.UsageEventUncheckedCreateInput = {
      platformUserId: userId,
      eventType,
      metadata: metadata as Prisma.InputJsonValue | undefined,
      deviceType: classifyDeviceType(client.userAgent),
      country: placeOfIp(client.ipAddress ?? null),
    };
    // Settings › Data & privacy: nothing is counted for someone who said no.
    void this.prisma.user
      .count({ where: { id: userId, shareUsage: false } })
      .then((optedOut) => (optedOut ? null : this.prisma.usageEvent.create({ data, select: { id: true } })))
      .catch((error: unknown) => {
      this.logger.warn(`Could not record usage event ${eventType}: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  // From a customer request. A super admin's "View as customer" session is
  // skipped: an admin looking around is not the customer using the app.
  recordFor(user: RequestUser | undefined, req: Request, eventType: UsageEventType, metadata?: Record<string, unknown>, dedupeKey?: string): void {
    if (!user || user.impersonatedBy) return;
    const userAgent = req.headers['user-agent'];
    this.record(user.id, eventType, metadata, { userAgent: typeof userAgent === 'string' ? userAgent : null, ipAddress: req.ip }, dedupeKey);
  }
}
