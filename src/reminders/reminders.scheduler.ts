import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import type { Prisma, ReminderKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { PushService } from '../push/push.service.js';
import {
  beforeFire,
  challengeDay,
  challengeDone,
  CLOCK_REGEX,
  dhakaInstant,
  dhakaParts,
  isNamazKey,
  isRamadanKey,
  PRAYER_NAMES,
  reminderKey,
  reminderUrl,
  TIMED_KINDS,
  timedFires,
  todoDays,
  windowClocks,
  windowDays,
  type Fire,
} from './fire-times.js';
import { DEFAULT_PRAYER_SETTINGS, isRamadan, prayerTimesFor, type DayPrayerTimes, type PrayerSettingsInput } from './prayer-times.js';
import { reminderPush, type ReminderData } from './reminder-text.js';

const MINUTE_MS = 60 * 1000;
// A tick runs this long after the minute turns, so "now" is safely inside it.
const TICK_OFFSET_MS = 500;

// Who can get a reminder: the master switch on, and an account in use.
const REMINDABLE_USER = { remindHabits: true, status: 'ACTIVE' } satisfies Prisma.UserWhereInput;

// One bell row to write, and push if it is new.
interface Draft {
  userId: string;
  key: string;
  data: ReminderData;
}

const dateOf = (day: string): Date => new Date(`${day}T00:00:00.000Z`);
const dayOfDate = (date: Date): string => date.toISOString().slice(0, 10);

const settingsKey = (s: PrayerSettingsInput) => `${s.latitude},${s.longitude},${s.method},${s.asrSchool},${s.hijriAdjust}`;

// Fires the Habit Tracker's reminders -- the app's first and only timer.
// Once a minute it finds every reminder due in the catch-up window (see
// fire-times.ts), writes each as a bell row whose key names the reminder
// and its firing, and pushes only the rows that were actually new: so a
// restart, an overlapping tick or a second server never sends one twice.
@Injectable()
export class RemindersScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RemindersScheduler.name);
  private timeout?: NodeJS.Timeout;
  private interval?: NodeJS.Timeout;
  private running = false;
  // Prayer times per person per day, worked out once ("<userId>|<day>|<settings>").
  private prayerCache = new Map<string, DayPrayerTimes>();
  private prayerCacheDays = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test' || process.env.REMINDERS_DISABLED === '1') {
      this.logger.log('Reminders are off (NODE_ENV=test or REMINDERS_DISABLED=1)');
      return;
    }
    const untilNextMinute = MINUTE_MS - (Date.now() % MINUTE_MS) + TICK_OFFSET_MS;
    this.timeout = setTimeout(() => {
      void this.tick();
      this.interval = setInterval(() => void this.tick(), MINUTE_MS);
      this.interval.unref();
    }, untilNextMinute);
    this.timeout.unref();
  }

  onModuleDestroy() {
    clearTimeout(this.timeout);
    clearInterval(this.interval);
  }

  // One pass. A tick still running when the next is due lets it go: the
  // window covers the minutes it would have seen.
  async tick(now = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const drafts = (
        await Promise.all([
          this.guard('timed', () => this.timed(now)),
          this.guard('prayer', () => this.prayers(now)),
          this.guard('to-do', () => this.todos(now)),
        ])
      ).flat();
      await this.deliver(drafts);
    } catch (error) {
      this.logger.warn(`Reminder tick failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  // One kind's failure costs only that kind's reminders this tick.
  private async guard(name: string, run: () => Promise<Draft[]>): Promise<Draft[]> {
    try {
      return await run();
    } catch (error) {
      this.logger.warn(`Reminder check (${name}) failed: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  // Writes the bell rows; a key already there (an earlier tick, another
  // server) is skipped, and only the rows written now are pushed.
  private async deliver(drafts: Draft[]): Promise<void> {
    if (drafts.length === 0) return;
    const unique = [...new Map(drafts.map((draft) => [`${draft.userId}|${draft.key}`, draft])).values()];
    const inserted = await this.prisma.userNotification.createManyAndReturn({
      data: unique.map((draft) => ({
        userId: draft.userId,
        key: draft.key,
        type: 'REMINDER',
        businessId: null,
        data: draft.data as unknown as Prisma.InputJsonObject,
      })),
      skipDuplicates: true,
      select: { userId: true, data: true },
    });
    if (inserted.length === 0) return;
    await this.push.send(inserted.map((row) => ({ userId: row.userId, build: (locale) => reminderPush(row.data as unknown as ReminderData, locale) })));
  }

  // Habits, challenges, books and skills: set on a clock.
  private async timed(now: Date): Promise<Draft[]> {
    const rows = await this.prisma.reminder.findMany({
      where: { enabled: true, kind: { in: [...TIMED_KINDS] }, times: { hasSome: windowClocks(now) }, user: REMINDABLE_USER },
      select: { userId: true, kind: true, targetKey: true, times: true, weekdays: true },
    });
    const due = rows.flatMap((row) => timedFires(row, now).map((fire) => ({ row, fire })));
    if (due.length === 0) return [];

    const idsOf = (kind: ReminderKind) => [...new Set(due.filter((d) => d.row.kind === kind).map((d) => d.row.targetKey))];
    const days = windowDays(now).map(dateOf);
    const [habits, logs, trackers, books, skills] = await Promise.all([
      this.prisma.habit.findMany({ where: { id: { in: idsOf('HABIT') }, isArchived: false }, select: { id: true, userId: true, name: true } }),
      this.prisma.habitLog.findMany({ where: { habitId: { in: idsOf('HABIT') }, date: { in: days }, completed: true }, select: { habitId: true, date: true } }),
      this.prisma.habitMonthTracker.findMany({
        where: { id: { in: idsOf('CHALLENGE') }, category: 'Others' },
        select: { id: true, userId: true, name: true, totalDays: true, items: true, createdAt: true, checks: { select: { day: true, item: true } } },
      }),
      this.prisma.book.findMany({ where: { id: { in: idsOf('BOOK') } }, select: { id: true, userId: true, title: true } }),
      this.prisma.skill.findMany({ where: { id: { in: idsOf('SKILL') } }, select: { id: true, userId: true, name: true } }),
    ]);
    const habitById = new Map(habits.map((h) => [h.id, h]));
    const doneHabit = new Set(logs.map((log) => `${log.habitId}|${dayOfDate(log.date)}`));
    const trackerById = new Map(trackers.map((t) => [t.id, t]));
    const bookById = new Map(books.map((b) => [b.id, b]));
    const skillById = new Map(skills.map((s) => [s.id, s]));

    const drafts: Draft[] = [];
    for (const { row, fire } of due) {
      const name = this.timedName(row, fire, { habitById, doneHabit, trackerById, bookById, skillById });
      if (name === null) continue;
      drafts.push({
        userId: row.userId,
        key: reminderKey(row.kind, row.targetKey, fire),
        data: { kind: row.kind, targetKey: row.targetKey, name, at: fire.clock, url: reminderUrl(row.kind, row.targetKey) },
      });
    }
    return drafts;
  }

  // What a timed reminder is about, by name -- or null when it shouldn't
  // fire: the thing is gone or someone else's, today's habit is done, or
  // today's challenge is ticked (or the challenge is over).
  private timedName(
    row: { userId: string; kind: ReminderKind; targetKey: string },
    fire: Fire,
    found: {
      habitById: Map<string, { userId: string; name: string }>;
      doneHabit: Set<string>;
      trackerById: Map<
        string,
        { userId: string; name: string | null; totalDays: number | null; items: string[]; createdAt: Date; checks: { day: number; item: string }[] }
      >;
      bookById: Map<string, { userId: string; title: string }>;
      skillById: Map<string, { userId: string; name: string }>;
    },
  ): string | null {
    switch (row.kind) {
      case 'HABIT': {
        const habit = found.habitById.get(row.targetKey);
        if (!habit || habit.userId !== row.userId || found.doneHabit.has(`${row.targetKey}|${fire.day}`)) return null;
        return habit.name;
      }
      case 'CHALLENGE': {
        const tracker = found.trackerById.get(row.targetKey);
        if (!tracker || tracker.userId !== row.userId) return null;
        const n = challengeDay(tracker.createdAt, tracker.totalDays, fire.day);
        if (n === null) return null;
        const ticked = tracker.checks.filter((check) => check.day === n).map((check) => check.item);
        if (challengeDone(tracker.items, ticked)) return null;
        return tracker.name ?? '';
      }
      case 'BOOK': {
        const book = found.bookById.get(row.targetKey);
        return book && book.userId === row.userId ? book.title : null;
      }
      case 'SKILL': {
        const skill = found.skillById.get(row.targetKey);
        return skill && skill.userId === row.userId ? skill.name : null;
      }
      default:
        return null;
    }
  }

  // Namaz (each prayer) and Ramadan (Sehri's end, Iftar), from the day's
  // times for the person's prayer settings, minutesBefore ahead.
  private async prayers(now: Date): Promise<Draft[]> {
    const rows = await this.prisma.reminder.findMany({
      where: { enabled: true, kind: { in: ['NAMAZ', 'RAMADAN'] }, user: REMINDABLE_USER },
      select: { userId: true, kind: true, targetKey: true, minutesBefore: true },
    });
    if (rows.length === 0) return [];
    const userIds = [...new Set(rows.map((row) => row.userId))];
    const saved = await this.prisma.prayerSettings.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, latitude: true, longitude: true, method: true, asrSchool: true, hijriAdjust: true },
    });
    const settingsOf = new Map<string, PrayerSettingsInput>(saved.map((s) => [s.userId, s]));

    // A prayer whose reminder fires in the window is on a window day, or
    // early tomorrow with a long lead.
    const days = todoDays(now);
    this.prunePrayerCache(days);

    const due: { userId: string; kind: ReminderKind; targetKey: string; minutesBefore: number; day: string; moment: Date; fire: Fire }[] = [];
    for (const row of rows) {
      const settings = settingsOf.get(row.userId) ?? DEFAULT_PRAYER_SETTINGS;
      for (const day of days) {
        let moment: Date | null = null;
        if (row.kind === 'NAMAZ' && isNamazKey(row.targetKey)) moment = this.timesFor(row.userId, settings, day)[row.targetKey];
        else if (row.kind === 'RAMADAN' && isRamadanKey(row.targetKey) && isRamadan(day, settings.hijriAdjust)) {
          const times = this.timesFor(row.userId, settings, day);
          moment = row.targetKey === 'sehri' ? times.fajr : times.maghrib;
        }
        if (!moment) continue;
        const fire = beforeFire(moment, row.minutesBefore, now);
        if (fire) due.push({ ...row, day, moment, fire });
      }
    }
    if (due.length === 0) return [];

    // A prayer already marked on today's Namaz sheet needs no reminder.
    const namaz = due.filter((d) => d.kind === 'NAMAZ');
    const marked = new Set<string>();
    if (namaz.length > 0) {
      const months = [...new Map(namaz.map((d) => [d.day.slice(0, 7), { month: Number(d.day.slice(5, 7)), year: Number(d.day.slice(0, 4)) }])).values()];
      const sheets = await this.prisma.habitMonthTracker.findMany({
        where: { userId: { in: [...new Set(namaz.map((d) => d.userId))] }, category: 'Namaz', OR: months },
        select: {
          userId: true,
          month: true,
          year: true,
          checks: { where: { day: { in: [...new Set(namaz.map((d) => Number(d.day.slice(8, 10))))] } }, select: { day: true, item: true } },
        },
      });
      for (const sheet of sheets) {
        for (const check of sheet.checks) {
          marked.add(`${sheet.userId}|${sheet.year}-${String(sheet.month).padStart(2, '0')}-${String(check.day).padStart(2, '0')}|${check.item}`);
        }
      }
    }

    const drafts: Draft[] = [];
    for (const d of due) {
      const prayer = d.kind === 'NAMAZ' && isNamazKey(d.targetKey) ? PRAYER_NAMES[d.targetKey] : undefined;
      if (prayer && marked.has(`${d.userId}|${d.day}|${prayer}`)) continue;
      const name = prayer ?? (d.targetKey === 'sehri' ? 'Sehri' : 'Iftar');
      drafts.push({
        userId: d.userId,
        key: reminderKey(d.kind, d.targetKey, d.fire),
        data: {
          kind: d.kind,
          targetKey: d.targetKey,
          name,
          at: dhakaParts(d.moment).clock,
          ...(prayer && { prayer }),
          minutesBefore: d.minutesBefore,
          url: reminderUrl(d.kind, d.targetKey),
        },
      });
    }
    return drafts;
  }

  // Today's (and early tomorrow's) unfinished tasks with a time and a
  // reminder, remindBefore minutes ahead of the time.
  private async todos(now: Date): Promise<Draft[]> {
    const items = await this.prisma.todoItem.findMany({
      where: {
        completed: false,
        dueTime: { not: null },
        remindBefore: { not: null },
        list: { date: { in: todoDays(now).map(dateOf) }, user: REMINDABLE_USER },
      },
      select: { id: true, text: true, dueTime: true, remindBefore: true, list: { select: { userId: true, date: true } } },
    });
    const drafts: Draft[] = [];
    for (const item of items) {
      if (!item.dueTime || item.remindBefore === null || !CLOCK_REGEX.test(item.dueTime)) continue;
      const fire = beforeFire(dhakaInstant(dayOfDate(item.list.date), item.dueTime), item.remindBefore, now);
      if (!fire) continue;
      drafts.push({
        userId: item.list.userId,
        key: reminderKey('TODO', item.id, fire),
        data: { kind: 'TODO', targetKey: item.id, name: item.text, at: item.dueTime, minutesBefore: item.remindBefore, url: reminderUrl('TODO', item.id) },
      });
    }
    return drafts;
  }

  private timesFor(userId: string, settings: PrayerSettingsInput, day: string): DayPrayerTimes {
    const key = `${userId}|${day}|${settingsKey(settings)}`;
    let times = this.prayerCache.get(key);
    if (!times) {
      times = prayerTimesFor(settings, day);
      this.prayerCache.set(key, times);
    }
    return times;
  }

  // The cache only ever holds the days a tick looks at.
  private prunePrayerCache(days: string[]) {
    const id = days.join(',');
    if (id === this.prayerCacheDays) return;
    this.prayerCacheDays = id;
    for (const key of this.prayerCache.keys()) if (!days.includes(key.split('|')[1])) this.prayerCache.delete(key);
  }
}
