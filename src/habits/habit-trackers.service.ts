import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateHabitTrackerDto } from './dto/create-habit-tracker.dto.js';
import { SetHabitTrackerCheckDto } from './dto/set-habit-tracker-check.dto.js';

// Which habit categories can have a month sheet, and the checkbox columns
// each one gets. Only Namaz for now -- its five daily prayers.
const TRACKER_ITEMS_BY_CATEGORY: Record<string, string[]> = {
  Namaz: ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'],
};

function daysInMonth(month: number, year: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
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
// null -- the sheet highlights that row, so the client never has to guess
// the date (or its timezone) itself.
function todayDayFor(month: number, year: number): number | null {
  const today = todayInDhaka();
  return today.year === year && today.month === month ? today.day : null;
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
    const trackers = await this.prisma.habitMonthTracker.findMany({
      where: { userId, ...(category && { category }) },
      include: { checks: { select: { day: true, item: true } } },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
    return trackers.map((t) => this.toView(t));
  }

  async create(userId: string, dto: CreateHabitTrackerDto): Promise<HabitTrackerView> {
    // hasOwn, not a plain lookup: "constructor"/"toString"/... would otherwise
    // resolve to an inherited Object.prototype member and slip past this guard.
    if (!Object.hasOwn(TRACKER_ITEMS_BY_CATEGORY, dto.category)) {
      throw new BadRequestException(`Month trackers are only available for: ${Object.keys(TRACKER_ITEMS_BY_CATEGORY).join(', ')}`);
    }

    const items = TRACKER_ITEMS_BY_CATEGORY[dto.category];

    const existing = await this.prisma.habitMonthTracker.findUnique({
      where: { userId_category_month_year: { userId, category: dto.category, month: dto.month, year: dto.year } },
    });
    if (existing) {
      throw new ConflictException(`A ${dto.category} tracker for ${dto.month}/${dto.year} already exists`);
    }

    try {
      const created = await this.prisma.habitMonthTracker.create({
        data: { userId, category: dto.category, month: dto.month, year: dto.year, items },
        include: { checks: { select: { day: true, item: true } } },
      });
      return this.toView(created);
    } catch (error) {
      // Two simultaneous identical creates (double-click, second tab) both
      // pass the existence check above; the loser hits the unique index.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`A ${dto.category} tracker for ${dto.month}/${dto.year} already exists`);
      }
      throw error;
    }
  }

  // Idempotent by design (explicit `checked`, not a toggle) so a double-fired
  // or retried request can never flip a cell the wrong way.
  async setCheck(userId: string, id: string, dto: SetHabitTrackerCheckDto): Promise<{ day: number; item: string; checked: boolean }> {
    const tracker = await this.requireTracker(userId, id);
    if (!tracker.items.includes(dto.item)) {
      throw new BadRequestException(`Unknown item "${dto.item}" for this tracker`);
    }
    if (dto.day > daysInMonth(tracker.month, tracker.year)) {
      throw new BadRequestException(`Day ${dto.day} is outside this month`);
    }

    if (dto.checked) {
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

  async remove(userId: string, id: string): Promise<{ id: string }> {
    await this.requireTracker(userId, id);
    await this.prisma.habitMonthTracker.delete({ where: { id } });
    return { id };
  }

  private toView(tracker: {
    id: string;
    category: string;
    month: number;
    year: number;
    items: string[];
    checks: { day: number; item: string }[];
  }): HabitTrackerView {
    return {
      id: tracker.id,
      category: tracker.category,
      month: tracker.month,
      year: tracker.year,
      items: tracker.items,
      totalDays: daysInMonth(tracker.month, tracker.year),
      elapsedDays: elapsedDays(tracker.month, tracker.year),
      todayDay: todayDayFor(tracker.month, tracker.year),
      checks: tracker.checks,
    };
  }

  private async requireTracker(userId: string, id: string) {
    const tracker = await this.prisma.habitMonthTracker.findUnique({ where: { id } });
    if (!tracker || tracker.userId !== userId) {
      throw new NotFoundException('Tracker not found');
    }
    return tracker;
  }
}
