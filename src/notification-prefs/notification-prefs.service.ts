import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { dhakaDateKey } from '../common/dhaka.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpdateNotificationPrefsDto } from './dto/update-notification-prefs.dto.js';
import { ALERTS, type AlertKey, allows, type Channel, CHANNELS, countOn, defaultPrefs, type NotificationPrefs, resolvePrefs } from './notification-prefs.js';

const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
const dhakaClock = (now: Date) => new Date(now.getTime() + DHAKA_OFFSET_MS).toISOString().slice(11, 16);

// Settings › Notifications: the person's choices, read by every sender
// that goes through allows() (the bell's feed, push), and the older
// reminder switches kept in step so their writers keep working.
@Injectable()
export class NotificationPrefsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<NotificationPrefs> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { notificationPrefs: true } });
    return resolvePrefs(user.notificationPrefs);
  }

  // Many people's choices at once (a batch of pushes), and whether each is
  // on a paid plan (SMS).
  async forUsers(userIds: string[]): Promise<Map<string, { prefs: NotificationPrefs; pro: boolean }>> {
    if (userIds.length === 0) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, notificationPrefs: true, subscription: { select: { status: true, plan: { select: { price: true } } } } },
    });
    return new Map(users.map((user) => [user.id, { prefs: resolvePrefs(user.notificationPrefs), pro: isPro(user.subscription) }]));
  }

  // The page: the choices, how many are on, the plan, and where things go.
  async page(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, phone: true, phoneVerifiedAt: true, notificationPrefs: true, subscription: { select: { status: true, plan: { select: { price: true } } } } },
    });
    const devices = await this.prisma.pushSubscription.findMany({ where: { userId }, select: { userAgent: true }, orderBy: { lastUsedAt: 'desc' }, take: 5 });
    const prefs = resolvePrefs(user.notificationPrefs);
    return {
      prefs,
      ...countOn(prefs),
      pro: isPro(user.subscription),
      locked: Object.fromEntries(ALERTS.filter((alert) => alert.locked).map((alert) => [alert.key, alert.locked])),
      destinations: { email: user.email, phone: user.phoneVerifiedAt ? user.phone : null, devices: devices.map((row) => row.userAgent ?? '') },
    };
  }

  async update(userId: string, dto: UpdateNotificationPrefsDto) {
    const current = dto.reset ? defaultPrefs() : await this.get(userId);
    const next: NotificationPrefs = {
      ...current,
      alerts: { ...current.alerts },
      quiet: { ...current.quiet },
      summary: { ...current.summary },
    };
    for (const [key, row] of Object.entries(dto.alerts ?? {})) {
      if (!next.alerts[key] || typeof row !== 'object' || row === null) continue;
      next.alerts[key] = { ...next.alerts[key] };
      for (const channel of CHANNELS) if (typeof row[channel] === 'boolean') next.alerts[key][channel] = row[channel];
    }
    if (dto.loanDaysBefore !== undefined) next.loanDaysBefore = dto.loanDaysBefore;
    if (dto.eventDaysBefore !== undefined) next.eventDaysBefore = dto.eventDaysBefore;
    if (dto.quietOn !== undefined) next.quiet.on = dto.quietOn;
    if (dto.quietFrom !== undefined) next.quiet.from = dto.quietFrom;
    if (dto.quietTo !== undefined) next.quiet.to = dto.quietTo;
    if (next.quiet.on && next.quiet.from === next.quiet.to) throw new BadRequestException('Start and end can\'t be the same time.');
    if (dto.summaryMode !== undefined) next.summary.mode = dto.summaryMode;
    if (dto.summaryDay !== undefined) next.summary.day = dto.summaryDay;
    if (dto.summaryTime !== undefined) next.summary.time = dto.summaryTime;
    const prefs = resolvePrefs(next);
    const any = (key: AlertKey) => CHANNELS.some((channel) => prefs.alerts[key][channel]);
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        notificationPrefs: prefs as unknown as Prisma.InputJsonObject,
        // The older switches the reminder writers read.
        remindBudget: any('budget'),
        remindLoans: any('loanDue') || any('collect'),
        remindSavings: any('goalCheck'),
        referralEmailEarned: prefs.alerts.refEarn.email,
      },
    });
    return this.page(userId);
  }

  // Whether one alert may reach one person on one channel now.
  allowed(entry: { prefs: NotificationPrefs; pro: boolean } | undefined, alert: AlertKey, channel: Channel, now = new Date()): boolean {
    const prefs = entry?.prefs ?? defaultPrefs();
    return allows(prefs, alert, channel, { pro: entry?.pro ?? false, dhakaClock: dhakaClock(now) });
  }
}

// A paid plan that is running (SMS alerts are Pro's).
function isPro(subscription: { status: string; plan: { price: Prisma.Decimal } } | null): boolean {
  return !!subscription && ['ACTIVE', 'TRIALING', 'PAST_DUE'].includes(subscription.status) && Number(subscription.plan.price) > 0;
}

export const todayInDhaka = (now = new Date()) => dhakaDateKey(now);
