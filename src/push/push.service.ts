import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service.js';
import type { SubscribePushDto } from './dto/push-subscription.dto.js';
import { pushLocale, testPush, type PushLocale, type PushPayload } from './push-payload.js';

// A push service keeps an undelivered message this long (the phone is off,
// say); a reminder later than that is no use.
const TTL_SECONDS = 30 * 60;
// Devices one customer may keep; a new one past this replaces the one
// unused longest.
const MAX_SUBSCRIPTIONS_PER_USER = 20;
const MAX_USER_AGENT_LENGTH = 512;

// One push to send: whose devices, and the words for each device's language.
export interface PushMessage {
  userId: string;
  build: (locale: PushLocale) => PushPayload;
}

// Web push (the `web-push` package) to customers' browsers and phones. Off
// when the VAPID keys aren't set: the bell still gets every reminder.
@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private publicKeyValue: string | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
    const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
    const subject = process.env.VAPID_SUBJECT?.trim();
    if (!publicKey || !privateKey || !subject) {
      this.logger.log('Web push is off: set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT to turn it on');
      return;
    }
    try {
      webpush.setVapidDetails(subject, publicKey, privateKey);
      this.publicKeyValue = publicKey;
    } catch (error) {
      this.logger.error(`Web push is off: the VAPID settings were refused (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  get enabled(): boolean {
    return this.publicKeyValue !== null;
  }

  // GET /api/push/key: what the browser subscribes with, or null when push
  // is off.
  publicKey(): { publicKey: string | null } {
    return { publicKey: this.publicKeyValue };
  }

  // Saves this device for this customer. An endpoint belongs to one browser
  // profile, so a device someone else used before moves to whoever signed
  // in on it now.
  async subscribe(userId: string, dto: SubscribePushDto, userAgent: string | undefined): Promise<{ ok: true }> {
    const fields = {
      userId,
      p256dh: dto.keys.p256dh,
      auth: dto.keys.auth,
      locale: pushLocale(dto.locale),
      userAgent: userAgent ? userAgent.slice(0, MAX_USER_AGENT_LENGTH) : null,
      lastUsedAt: new Date(),
    };
    await this.prisma.pushSubscription.upsert({ where: { endpoint: dto.endpoint }, create: { endpoint: dto.endpoint, ...fields }, update: fields });
    const extra = await this.prisma.pushSubscription.findMany({
      where: { userId },
      orderBy: { lastUsedAt: 'desc' },
      skip: MAX_SUBSCRIPTIONS_PER_USER,
      select: { id: true },
    });
    if (extra.length > 0) await this.prisma.pushSubscription.deleteMany({ where: { id: { in: extra.map((row) => row.id) } } });
    return { ok: true };
  }

  // "Turn off" on this device: only the caller's own row goes.
  async unsubscribe(userId: string, endpoint: string): Promise<{ ok: true }> {
    await this.prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
    return { ok: true };
  }

  // "Send a test": every device of the caller.
  async sendTest(userId: string): Promise<{ sent: number }> {
    return { sent: await this.send([{ userId, build: testPush }]) };
  }

  // Sends each message to every device of its customer, each in that
  // device's language, and returns how many were delivered. A device the
  // push service no longer knows (404/410) is forgotten. Never throws: a
  // failed push must not cost the caller (the scheduler's tick) anything.
  async send(messages: PushMessage[]): Promise<number> {
    if (!this.enabled || messages.length === 0) return 0;
    try {
      const userIds = [...new Set(messages.map((message) => message.userId))];
      const subscriptions = await this.prisma.pushSubscription.findMany({ where: { userId: { in: userIds } } });
      const byUser = new Map<string, typeof subscriptions>();
      for (const row of subscriptions) byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row]);

      const jobs = messages.flatMap((message) => (byUser.get(message.userId) ?? []).map((row) => ({ row, payload: message.build(pushLocale(row.locale)) })));
      const results = await Promise.allSettled(
        jobs.map(({ row, payload }) =>
          webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, JSON.stringify(payload), {
            TTL: TTL_SECONDS,
            urgency: 'high',
          }),
        ),
      );

      const delivered: string[] = [];
      const gone: string[] = [];
      results.forEach((result, i) => {
        const { row } = jobs[i];
        if (result.status === 'fulfilled') {
          delivered.push(row.id);
          return;
        }
        const status = (result.reason as { statusCode?: number } | undefined)?.statusCode;
        if (status === 404 || status === 410) gone.push(row.id);
        else
          this.logger.warn(
            `Push to a device of user ${row.userId} failed: ${status ?? (result.reason instanceof Error ? result.reason.message : String(result.reason))}`,
          );
      });
      if (delivered.length > 0) await this.prisma.pushSubscription.updateMany({ where: { id: { in: delivered } }, data: { lastUsedAt: new Date() } });
      if (gone.length > 0) await this.prisma.pushSubscription.deleteMany({ where: { id: { in: gone } } });
      return delivered.length;
    } catch (error) {
      this.logger.warn(`Push failed: ${error instanceof Error ? error.message : String(error)}`);
      return 0;
    }
  }
}
