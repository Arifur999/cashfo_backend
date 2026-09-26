import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AddTrackerItemDto } from './dto/add-tracker-item.dto.js';
import { CreateHabitTrackerDto } from './dto/create-habit-tracker.dto.js';
import { CreateRamadanTrackerDto } from './dto/create-ramadan-tracker.dto.js';
import { SetHabitTrackerCheckDto } from './dto/set-habit-tracker-check.dto.js';

// Hijri month number of Ramadan -- what a Ramadan sheet stores in
// HabitMonthTracker.month (its `year` is the Gregorian year the user typed).
const RAMADAN_MONTH = 9;
const MAX_ITEMS = 20;
const MAX_ITEM_NAME_LENGTH = 40;

interface TrackerConfig {
  // 'gregorian': a real calendar month (Create Month). 'ramadan': a sheet of
  // 29/30 days keyed by year alone (Create Ramadan).
  kind: 'gregorian' | 'ramadan';
  // Columns a new sheet starts with.
  items: string[];
  // Whether the user may add/remove columns. Namaz's five prayers are fixed.
  editableItems: boolean;
}

// Which habit categories can have a month sheet, and how each behaves.
const TRACKER_CONFIG: Record<string, TrackerConfig> = {
  Namaz: { kind: 'gregorian', items: ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'], editableItems: false },
  Ramadan: { kind: 'ramadan', items: ['Roza'], editableItems: true },
};

// hasOwn, not a plain lookup: "constructor"/"toString"/... would otherwise
// resolve to an inherited Object.prototype member and slip past the guard.
function configFor(category: string): TrackerConfig | null {
  return Object.hasOwn(TRACKER_CONFIG, category) ? TRACKER_CONFIG[category] : null;
}

// Text a habit name / category filter must never contain: control characters
// (a NUL byte can't be stored in a Postgres text column -- it surfaces as a
// 500) and lone UTF-16 surrogates (Postgres silently stores them as U+FFFD,
// so "the same name" could be added again and again as separate columns).
// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const UNSAFE_TEXT = /[\u0000-\u001f\u007f]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

function daysInMonth(month: number, year: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// A sheet's real number of days: Ramadan stores it (29 or 30), a Gregorian
// month is computed. Every day-bound check goes through this -- a Ramadan
// row's month=9 would otherwise read as September (30 days) and let a
// 29-day sheet accept day 30.
function sheetDays(tracker: { month: number; year: number; totalDays: number | null }): number {
  return tracker.totalDays ?? daysInMonth(tracker.month, tracker.year);
}

// "Today" for a month sheet is the Asia/Dhaka calendar date (a fixed UTC+6 --
// Bangladesh has no DST), not UTC: this is a Bangladesh-market app and the
// Fajr window (00:00-06:00 local) would otherwise fall on the PREVIOUS
// UTC day, mis-highlighting today and delaying when yesterday's unticked
// prayers count as missed. (HabitsService's older /api/habits endpoints
// still use UTC.)
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

function todayInDhaka(): { year: number; month: number; day: number } {
  const d = new Date(Date.now() + DHAKA_OFFSET_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

// Days of this sheet's month that are fully behind us (strictly before
// today). Only these can count as "missed": an unticked cell today or in
// the future isn't a miss yet. The client derives the Cross total from this
// plus the ticked cells.
function elapsedDays(month: number, year: number): number {
  const today = todayInDhaka();
  const currentKey = today.year * 12 + (today.month - 1);
  const sheetKey = year * 12 + (month - 1);
  if (sheetKey < currentKey) return daysInMonth(month, year);
  if (sheetKey === currentKey) return today.day - 1;
  return 0;
}

// The day-of-month that is "today" if this sheet is the current month, else
// null -- the sheet highlights that day column, so the client never has to guess
// the date (or its timezone) itself.
function todayDayFor(month: number, year: number): number | null {
  const today = todayInDhaka();
  return today.year === year && today.month === month ? today.day : null;
}

// The last day of a calendar-month sheet that can be ticked: today, or every
// day of a month that is already over; none of a month that hasn't started.
// (Unticking is never restricted, so a tick that already exists on a future
// day -- made before this rule -- can still be removed.)
function lastTickableDay(month: number, year: number): number {
  return todayDayFor(month, year) ?? elapsedDays(month, year);
}

function alreadyExistsMessage(category: string, month: number, year: number): string {
  return configFor(category)?.kind === 'ramadan' ? `Ramadan ${year} already exists` : `A ${category} tracker for ${month}/${year} already exists`;
}

export interface HabitTrackerView {
  id: string;
  category: string;
  month: number;
  year: number;
  items: string[];
  totalDays: number;
  elapsedDays: number;
  todayDay: number | null;
  checks: { day: number; item: string }[];
}

@Injectable()
export class HabitTrackersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, category?: string): Promise<HabitTrackerView[]> {
    if (category && UNSAFE_TEXT.test(category)) {
      throw new BadRequestException('Invalid category');
    }
    const trackers = await this.prisma.habitMonthTracker.findMany({
      where: { userId, ...(category && { category }) },
      include: { checks: { select: { day: true, item: true } } },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
    return trackers.map((t) => this.toView(t));
  }

  async get(userId: string, id: string): Promise<HabitTrackerView> {
    const tracker = await this.prisma.habitMonthTracker.findUnique({
      where: { id },
      include: { checks: { select: { day: true, item: true } } },
    });
    if (!tracker || tracker.userId !== userId) {
      throw new NotFoundException('Tracker not found');
    }
    return this.toView(tracker);
  }

  // "Create Month" -- Gregorian-month categories only (Namaz).
  async create(userId: string, dto: CreateHabitTrackerDto): Promise<HabitTrackerView> {
    const config = configFor(dto.category);
    if (!config || config.kind !== 'gregorian') {
      const allowed = Object.entries(TRACKER_CONFIG)
        .filter(([, c]) => c.kind === 'gregorian')
        .map(([name]) => name);
      throw new BadRequestException(`Month trackers are only available for: ${allowed.join(', ')}`);
    }
    return this.insertTracker(userId, { category: dto.category, month: dto.month, year: dto.year, totalDays: null, items: config.items });
  }

  // "Create Ramadan" -- just a year and 29 or 30 days; the server fixes the
  // category and the month, the client never sends either.
  async createRamadan(userId: string, dto: CreateRamadanTrackerDto): Promise<HabitTrackerView> {
    return this.insertTracker(userId, {
      category: 'Ramadan',
      month: RAMADAN_MONTH,
      year: dto.year,
      totalDays: dto.days,
      items: TRACKER_CONFIG.Ramadan.items,
    });
  }

  // Idempotent by design (explicit `checked`, not a toggle) so a double-fired
  // or retried request can never flip a cell the wrong way.
  async setCheck(userId: string, id: string, dto: SetHabitTrackerCheckDto): Promise<{ day: number; item: string; checked: boolean }> {
    const tracker = await this.requireTracker(userId, id);
    if (!tracker.items.includes(dto.item)) {
      throw new BadRequestException(`Unknown item "${dto.item}" for this tracker`);
    }
    if (dto.day > sheetDays(tracker)) {
      throw new BadRequestException(`Day ${dto.day} is outside this sheet`);
    }

    if (dto.checked) {
      // A day that hasn't come yet can't be ticked. Ramadan sheets have no
      // calendar dates, so they're exempt.
      if (configFor(tracker.category)?.kind === 'gregorian' && dto.day > lastTickableDay(tracker.month, tracker.year)) {
        throw new BadRequestException("You can't tick a day that hasn't come yet");
      }
      // createMany + skipDuplicates is a single INSERT .. ON CONFLICT DO
      // NOTHING, so two simultaneous identical ticks can't race into a
      // unique-constraint error the way find-then-create/upsert can.
      await this.prisma.habitMonthCheck.createMany({
        data: [{ trackerId: id, day: dto.day, item: dto.item }],
        skipDuplicates: true,
      });
    } else {
      await this.prisma.habitMonthCheck.deleteMany({ where: { trackerId: id, day: dto.day, item: dto.item } });
    }
    return { day: dto.day, item: dto.item, checked: dto.checked };
  }

  // Add a habit column (Ramadan). Names are NFC-normalised and trimmed,
  // unique ignoring case, at most MAX_ITEMS per sheet.
  async addItem(userId: string, id: string, dto: AddTrackerItemDto): Promise<HabitTrackerView> {
    const name = dto.name.normalize('NFC').trim().replace(/\s+/g, ' ');
    if (name.length === 0 || name.length > MAX_ITEM_NAME_LENGTH) {
      throw new BadRequestException(`A habit name must be 1-${MAX_ITEM_NAME_LENGTH} characters`);
    }
    if (UNSAFE_TEXT.test(name)) {
      throw new BadRequestException("A habit name can't contain control or invalid characters");
    }
    return this.editItems(userId, id, (current) => {
      if (current.some((item) => item.toLowerCase() === name.toLowerCase())) {
        throw new ConflictException(`"${name}" is already on this sheet`);
      }
      if (current.length >= MAX_ITEMS) {
        throw new BadRequestException(`A sheet can have at most ${MAX_ITEMS} habits`);
      }
      // clear: ticks left under this name (e.g. from a previous removal) must
      // not reappear on the new column.
      return { next: [...current, name], clear: name };
    });
  }

  // Remove a habit column together with all of its ticks.
  async removeItem(userId: string, id: string, rawName: string): Promise<HabitTrackerView> {
    const name = (rawName ?? '').normalize('NFC');
    return this.editItems(userId, id, (current) => {
      if (!current.includes(name)) {
        throw new NotFoundException('Habit not found on this sheet');
      }
      return { next: current.filter((item) => item !== name), clear: name };
    });
  }

  // A sheet can only be deleted while it has no ticked cells (its Tick total
  // is 0) -- once anything is ticked it's real history, so the user has to
  // untick everything first. Enforced here, not just by the UI, and as ONE
  // conditional delete (checks: none) so a tick landing between a "has any
  // ticks?" read and the delete can't slip through.
  async remove(userId: string, id: string): Promise<{ id: string }> {
    const tracker = await this.requireTracker(userId, id);
    // A tick that lands while its habit is being removed can leave a row under
    // a habit that no longer exists. It shows nowhere (toView hides it), so it
    // must not count as "ticked" and block the delete -- clear such rows first.
    await this.prisma.habitMonthCheck.deleteMany({ where: { trackerId: id, item: { notIn: tracker.items } } });
    const { count } = await this.prisma.habitMonthTracker.deleteMany({ where: { id, userId, checks: { none: {} } } });
    if (count === 0) {
      throw new BadRequestException('This tracker has ticks -- untick them all before deleting it');
    }
    return { id };
  }

  private async insertTracker(
    userId: string,
    data: { category: string; month: number; year: number; totalDays: number | null; items: string[] },
  ): Promise<HabitTrackerView> {
    const existing = await this.prisma.habitMonthTracker.findUnique({
      where: { userId_category_month_year: { userId, category: data.category, month: data.month, year: data.year } },
    });
    if (existing) {
      throw new ConflictException(alreadyExistsMessage(data.category, data.month, data.year));
    }

    try {
      const created = await this.prisma.habitMonthTracker.create({
        data: { userId, ...data, items: [...data.items] },
        include: { checks: { select: { day: true, item: true } } },
      });
      return this.toView(created);
    } catch (error) {
      // Two simultaneous identical creates (double-click, second tab) both
      // pass the existence check above; the loser hits the unique index.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(alreadyExistsMessage(data.category, data.month, data.year));
      }
      throw error;
    }
  }

  // Compare-and-swap on the `items` array: read it, compute the next array,
  // and write it only if it is STILL what was read (`items: { equals }`),
  // deleting the affected item's ticks in the same transaction. If another
  // request changed the list in between, re-read and redo the edit (up to 3
  // times) -- so two simultaneous adds of different names both land, and
  // two of the same name end as one success plus a 409 from `plan`.
  private async editItems(
    userId: string,
    id: string,
    plan: (current: string[]) => { next: string[]; clear: string },
  ): Promise<HabitTrackerView> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const tracker = await this.requireEditableTracker(userId, id);
      const { next, clear } = plan(tracker.items);
      const swapped = await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.habitMonthTracker.updateMany({
          where: { id, userId, items: { equals: tracker.items } },
          data: { items: { set: next } },
        });
        if (count === 0) return false;
        await tx.habitMonthCheck.deleteMany({ where: { trackerId: id, item: clear } });
        return true;
      });
      if (swapped) return this.get(userId, id);
    }
    throw new ConflictException('This sheet was changed at the same time -- please try again');
  }

  private toView(tracker: {
    id: string;
    category: string;
    month: number;
    year: number;
    totalDays: number | null;
    items: string[];
    checks: { day: number; item: string }[];
  }): HabitTrackerView {
    // Ramadan sheets are just Day 1..N -- the start date isn't known, so
    // there's no "today" or elapsed-days notion for them.
    const isRamadan = configFor(tracker.category)?.kind === 'ramadan';
    return {
      id: tracker.id,
      category: tracker.category,
      month: tracker.month,
      year: tracker.year,
      items: tracker.items,
      totalDays: sheetDays(tracker),
      elapsedDays: isRamadan ? 0 : elapsedDays(tracker.month, tracker.year),
      todayDay: isRamadan ? null : todayDayFor(tracker.month, tracker.year),
      // Drop any tick whose habit was removed (a tick landing mid-removal
      // could otherwise leave an orphan row).
      checks: tracker.checks.filter((c) => tracker.items.includes(c.item)),
    };
  }

  private async requireTracker(userId: string, id: string) {
    const tracker = await this.prisma.habitMonthTracker.findUnique({ where: { id } });
    if (!tracker || tracker.userId !== userId) {
      throw new NotFoundException('Tracker not found');
    }
    return tracker;
  }

  private async requireEditableTracker(userId: string, id: string) {
    const tracker = await this.requireTracker(userId, id);
    if (!configFor(tracker.category)?.editableItems) {
      throw new BadRequestException("This tracker's habits are fixed");
    }
    return tracker;
  }
}
