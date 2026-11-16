import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { JournalEntry, JournalKind, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { CredentialsService } from '../auth/credentials.service.js';
import { dhakaDateKey } from '../common/dhaka.js';
import { currentStreak } from '../habits/streak.js';
import { unlockState, windowStartBefore, type UnlockState } from '../password-vault/vault-unlock-limit.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import type { SaveJournalEntryDto, SetDiaryPinDto } from './dto/journal.dto.js';
import { JournalUnlockService, type JournalUnlock } from './journal-unlock.service.js';
import { NotesService } from './notes.service.js';
import { isCalendarDay, monthBounds, tagsIn } from './writing-text.js';

export interface JournalEntryView {
  date: string;
  kind: JournalKind;
  mood: number;
  wentWell: string;
  gratefulFor: string;
  tomorrow: string;
  body: string;
  categoryId: string | null;
  tags: string[];
  isPrivate: boolean;
  locked: false;
  updatedAt: Date;
}

// A private entry while the diary is locked: only that the day has one.
export interface LockedEntryView {
  date: string;
  isPrivate: true;
  locked: true;
}

const ENTRY_FIELDS = {
  date: true,
  kind: true,
  mood: true,
  wentWell: true,
  gratefulFor: true,
  tomorrow: true,
  body: true,
  categoryId: true,
  tags: true,
  isPrivate: true,
  updatedAt: true,
} as const;

type EntryRow = Pick<JournalEntry, keyof typeof ENTRY_FIELDS>;

const dayKey = (date: Date) => date.toISOString().slice(0, 10);
const DAY_MS = 86_400_000;
// How far back the writing streak is followed, as the habits' is.
const STREAK_LOOK_BACK_DAYS = 730;
const SEARCH_LIMIT = 50;
const EARLIEST_DAY = '2000-01-01';

const fullView = (row: EntryRow): JournalEntryView => ({ ...row, date: dayKey(row.date), locked: false });
const shown = (row: EntryRow, unlocked: boolean): JournalEntryView | LockedEntryView =>
  row.isPrivate && !unlocked ? { date: dayKey(row.date), isPrivate: true, locked: true } : fullView(row);

const refuse = (status: HttpStatus, reason: string, message: string, extra: Record<string, unknown> = {}) =>
  new HttpException({ statusCode: status, error: HttpStatus[status], message, reason, ...extra }, status);

const lockedOut = (retryAfterSec: number) => {
  const minutes = Math.ceil(retryAfterSec / 60);
  return refuse(HttpStatus.TOO_MANY_REQUESTS, 'TOO_MANY_TRIES', `Too many wrong tries. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`, {
    retryAfterSec,
  });
};

// Habit Tracker > Write > Journal: one entry a day, a daily journal (three
// prompts and a note) or a free diary page. A private entry is shown and
// searched only after the diary PIN is entered on this sign-in
// (JournalUnlockService); until then the day shows only that it has one.
@Injectable()
export class JournalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notes: NotesService,
    private readonly unlocks: JournalUnlockService,
    private readonly credentials: CredentialsService,
  ) {}

  async month(user: RequestUser, month: string, unlockToken: string | undefined) {
    const { start, end } = monthBounds(month);
    const today = dhakaDateKey(new Date());
    const [settings, rows, days, total] = await Promise.all([
      this.settings(user.id),
      this.prisma.journalEntry.findMany({ where: { userId: user.id, date: { gte: start, lt: end } }, orderBy: { date: 'asc' }, select: ENTRY_FIELDS }),
      this.prisma.journalEntry.findMany({
        where: { userId: user.id, date: { gte: new Date(Date.parse(`${today}T00:00:00.000Z`) - STREAK_LOOK_BACK_DAYS * DAY_MS) } },
        select: { date: true },
      }),
      this.prisma.journalEntry.count({ where: { userId: user.id } }),
    ]);
    const unlocked = this.unlocks.opens(unlockToken, user.id, user.sessionId, settings?.diaryPinHash ?? null);
    const streak = currentStreak({ frequencyType: 'DAILY', weeklyDays: [], weeklyCount: null }, new Set(days.map((row) => dayKey(row.date))), today);
    return { month, today, pinSet: !!settings?.diaryPinHash, unlocked, streak, total, entries: rows.map((row) => shown(row, unlocked)) };
  }

  // Words or a #tag in any part of an entry, newest first. A private entry
  // only once the diary is open.
  async search(user: RequestUser, q: string, unlockToken: string | undefined) {
    const settings = await this.settings(user.id);
    const unlocked = this.unlocks.opens(unlockToken, user.id, user.sessionId, settings?.diaryPinHash ?? null);
    const term = q.replace(/^#+/, '').trim();
    if (!term) return { unlocked, entries: [] };
    const contains = { contains: term, mode: 'insensitive' as const };
    const rows = await this.prisma.journalEntry.findMany({
      where: {
        userId: user.id,
        ...(unlocked ? {} : { isPrivate: false }),
        OR: [{ wentWell: contains }, { gratefulFor: contains }, { tomorrow: contains }, { body: contains }, { tags: { has: term.toLowerCase() } }],
      },
      orderBy: { date: 'desc' },
      take: SEARCH_LIMIT,
      select: ENTRY_FIELDS,
    });
    return { unlocked, entries: rows.map(fullView) };
  }

  // Writes the day's entry whole. A private entry changes only while the
  // diary is open (else it would be overwritten unseen), and an entry turns
  // private only once a PIN exists to keep it so.
  async save(user: RequestUser, date: string, dto: SaveJournalEntryDto, unlockToken: string | undefined): Promise<JournalEntryView> {
    if (!isCalendarDay(date) || date < EARLIEST_DAY) throw new BadRequestException('Pick a real day');
    if (date > dhakaDateKey(new Date())) throw new BadRequestException('You can write for today or an earlier day.');
    const day = new Date(`${date}T00:00:00.000Z`);
    const [settings, existing] = await Promise.all([
      this.settings(user.id),
      this.prisma.journalEntry.findUnique({ where: { userId_date: { userId: user.id, date: day } }, select: { isPrivate: true } }),
    ]);
    const unlocked = this.unlocks.opens(unlockToken, user.id, user.sessionId, settings?.diaryPinHash ?? null);
    if (existing?.isPrivate && !unlocked) throw refuse(HttpStatus.LOCKED, 'JOURNAL_LOCKED', 'This entry is private. Enter your diary PIN to change it.');
    if (dto.isPrivate && !settings?.diaryPinHash) throw refuse(HttpStatus.CONFLICT, 'PIN_REQUIRED', 'Set a diary PIN first, so a private entry stays private.');
    await this.notes.requireCategory(user.id, dto.categoryId);

    // A diary page has no prompts: what the editor hides is never kept.
    const daily = dto.kind === 'DAILY';
    const fields = {
      kind: dto.kind,
      mood: dto.mood,
      wentWell: daily ? (dto.wentWell ?? '').trim() : '',
      gratefulFor: daily ? (dto.gratefulFor ?? '').trim() : '',
      tomorrow: daily ? (dto.tomorrow ?? '').trim() : '',
      body: (dto.body ?? '').trim(),
      categoryId: dto.categoryId ?? null,
      isPrivate: dto.isPrivate ?? existing?.isPrivate ?? false,
    };
    const data = { ...fields, tags: tagsIn([fields.wentWell, fields.gratefulFor, fields.tomorrow, fields.body]) };
    const row = await this.prisma.journalEntry.upsert({
      where: { userId_date: { userId: user.id, date: day } },
      create: { userId: user.id, date: day, ...data },
      update: data,
      select: ENTRY_FIELDS,
    });
    return fullView(row);
  }

  // Sets the diary PIN, or replaces it with the account password (someone
  // merely holding the signed-in device doesn't know it). Comes back with
  // the unlock, so the diary is open right after.
  async setPin(user: RequestUser, dto: SetDiaryPinDto): Promise<{ pinSet: true } & JournalUnlock> {
    await this.notes.start(user.id);
    const settings = await this.prisma.writingSettings.findUniqueOrThrow({ where: { userId: user.id }, select: { diaryPinHash: true } });
    if (settings.diaryPinHash) {
      if (!dto.password) throw refuse(HttpStatus.BAD_REQUEST, 'PASSWORD_REQUIRED', 'Enter your account password to change the diary PIN.');
      if (!(await this.credentials.verify(user.id, dto.password))) {
        if (!(await this.credentials.has(user.id))) {
          throw new BadRequestException(
            'Your account has no password yet because you sign in with Google. Set one with "Forgot password?" on the sign-in page, then come back.',
          );
        }
        throw refuse(HttpStatus.BAD_REQUEST, 'PASSWORD_WRONG', 'Your account password is incorrect');
      }
    }
    const diaryPinHash = await bcrypt.hash(dto.pin, 10);
    await this.prisma.writingSettings.update({ where: { userId: user.id }, data: { diaryPinHash, pinFailures: 0, pinFailedAt: null } });
    return { pinSet: true, ...this.unlocks.issue(user.id, user.sessionId, diaryPinHash) };
  }

  // Wrong PINs are counted per person: ten in ten minutes, then a wait even
  // for the right one (vault-unlock-limit.ts).
  async unlock(user: RequestUser, pin: string): Promise<JournalUnlock> {
    const now = new Date();
    const settings = await this.settings(user.id);
    if (!settings?.diaryPinHash) throw refuse(HttpStatus.CONFLICT, 'NO_PIN', 'You have no diary PIN yet.');
    const before = tries(settings, now);
    if (before.lockedOut) throw lockedOut(before.retryAfterSec);
    if (!(await bcrypt.compare(pin, settings.diaryPinHash))) {
      const after = await this.recordWrongPin(user.id, now);
      if (after.lockedOut) throw lockedOut(after.retryAfterSec);
      throw refuse(HttpStatus.UNAUTHORIZED, 'PIN_WRONG', 'Wrong PIN. Try again.', { triesLeft: after.triesLeft });
    }
    if (settings.pinFailures !== 0 || settings.pinFailedAt) {
      await this.prisma.writingSettings.update({ where: { userId: user.id }, data: { pinFailures: 0, pinFailedAt: null } });
    }
    return this.unlocks.issue(user.id, user.sessionId, settings.diaryPinHash);
  }

  // What the Habit Tracker's dashboard card shows: whether today is
  // written (its mood, unless it is private), the writing streak and the
  // newest note.
  async summary(userId: string) {
    const today = dhakaDateKey(new Date());
    const [todayRow, days, latest] = await Promise.all([
      this.prisma.journalEntry.findUnique({
        where: { userId_date: { userId, date: new Date(`${today}T00:00:00.000Z`) } },
        select: { mood: true, isPrivate: true },
      }),
      this.prisma.journalEntry.findMany({
        where: { userId, date: { gte: new Date(Date.parse(`${today}T00:00:00.000Z`) - STREAK_LOOK_BACK_DAYS * DAY_MS) } },
        select: { date: true },
      }),
      this.prisma.note.findFirst({
        where: { userId, archived: false },
        orderBy: { createdAt: 'desc' },
        select: { id: true, kind: true, title: true, body: true },
      }),
    ]);
    const streak = currentStreak({ frequencyType: 'DAILY', weeklyDays: [], weeklyCount: null }, new Set(days.map((row) => dayKey(row.date))), today);
    return {
      today: todayRow ? { written: true, mood: todayRow.isPrivate ? null : todayRow.mood } : { written: false, mood: null },
      streak,
      latestNote: latest,
    };
  }

  // Whether this request's diary unlock opens the private entries (the data
  // download asks, so it leaves them out without one).
  async opens(user: RequestUser, unlockToken: string | undefined): Promise<boolean> {
    const settings = await this.settings(user.id);
    return this.unlocks.opens(unlockToken, user.id, user.sessionId, settings?.diaryPinHash ?? null);
  }

  private settings(userId: string) {
    return this.prisma.writingSettings.findUnique({ where: { userId }, select: { diaryPinHash: true, pinFailures: true, pinFailedAt: true } });
  }

  // One more wrong PIN without losing one to a concurrent request: bump the
  // count inside a live window, or else start a new window at 1, each a
  // conditional update.
  private async recordWrongPin(userId: string, now: Date): Promise<UnlockState> {
    const windowStart = windowStartBefore(now);
    for (let attempt = 0; attempt < 3; attempt++) {
      const bumped = await this.prisma.writingSettings.updateMany({
        where: { userId, pinFailedAt: { gt: windowStart } },
        data: { pinFailures: { increment: 1 } },
      });
      if (bumped.count > 0) break;
      const fresh: Prisma.WritingSettingsWhereInput = { userId, OR: [{ pinFailedAt: null }, { pinFailedAt: { lte: windowStart } }] };
      const started = await this.prisma.writingSettings.updateMany({ where: fresh, data: { pinFailures: 1, pinFailedAt: now } });
      if (started.count > 0) break;
    }
    const row = await this.prisma.writingSettings.findUniqueOrThrow({ where: { userId }, select: { pinFailures: true, pinFailedAt: true } });
    return tries(row, now);
  }
}

const tries = (row: { pinFailures: number; pinFailedAt: Date | null }, now: Date): UnlockState =>
  unlockState({ vaultUnlockFailures: row.pinFailures, vaultUnlockFailedAt: row.pinFailedAt }, now);
