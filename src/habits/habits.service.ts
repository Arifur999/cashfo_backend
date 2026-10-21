import { Injectable, NotFoundException } from '@nestjs/common';
import { Habit } from '@prisma/client';
import { dhakaDateKey } from '../common/dhaka.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CheckInHabitDto } from './dto/check-in-habit.dto.js';
import { CreateHabitDto } from './dto/create-habit.dto.js';
import { UpdateHabitDto } from './dto/update-habit.dto.js';
import { bestStreak, currentStreak } from './streak.js';

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

@Injectable()
export class HabitsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Habits ----

  listHabits(userId: string, includeArchived = false, category?: string) {
    return this.prisma.habit.findMany({
      where: { userId, ...(includeArchived ? {} : { isArchived: false }), ...(category && { category }) },
      orderBy: { createdAt: 'asc' },
    });
  }

  createHabit(userId: string, dto: CreateHabitDto) {
    return this.prisma.habit.create({
      data: {
        userId,
        name: dto.name,
        category: dto.category ?? 'Others',
        icon: dto.icon ?? 'target',
        color: dto.color ?? 'blue',
        frequencyType: dto.frequencyType ?? 'DAILY',
        weeklyDays: dto.weeklyDays ?? [],
        weeklyCount: dto.weeklyCount,
        targetValue: dto.targetValue,
        unit: dto.unit,
      },
    });
  }

  async updateHabit(userId: string, id: string, dto: UpdateHabitDto) {
    await this.requireHabit(userId, id);
    return this.prisma.habit.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.icon !== undefined && { icon: dto.icon }),
        ...(dto.color !== undefined && { color: dto.color }),
        ...(dto.frequencyType !== undefined && { frequencyType: dto.frequencyType }),
        ...(dto.weeklyDays !== undefined && { weeklyDays: dto.weeklyDays }),
        ...(dto.weeklyCount !== undefined && { weeklyCount: dto.weeklyCount }),
        ...(dto.targetValue !== undefined && { targetValue: dto.targetValue }),
        ...(dto.unit !== undefined && { unit: dto.unit }),
        ...(dto.isArchived !== undefined && { isArchived: dto.isArchived }),
      },
    });
  }

  // Same delete-or-archive shape as GroupExpensesService.deleteMember(): hard
  // delete only if this habit has no check-in history at all; otherwise
  // archive so past logs/streaks keep pointing at a real habit.
  async deleteHabit(userId: string, id: string): Promise<{ id: string; action: 'deleted' | 'archived' }> {
    await this.requireHabit(userId, id);
    const logCount = await this.prisma.habitLog.count({ where: { habitId: id } });
    if (logCount === 0) {
      await this.prisma.habit.delete({ where: { id } });
      return { id, action: 'deleted' };
    }
    await this.prisma.habit.update({ where: { id }, data: { isArchived: true } });
    return { id, action: 'archived' };
  }

  // ---- Check-ins ----

  async checkIn(userId: string, habitId: string, dto: CheckInHabitDto) {
    await this.requireHabit(userId, habitId);
    const date = new Date(dto.date);
    return this.prisma.habitLog.upsert({
      where: { habitId_date: { habitId, date } },
      create: { habitId, date, completed: dto.completed ?? true, value: dto.value, note: dto.note },
      update: { completed: dto.completed ?? true, value: dto.value, note: dto.note },
    });
  }

  async removeCheckIn(userId: string, habitId: string, date: string): Promise<{ habitId: string; date: string }> {
    await this.requireHabit(userId, habitId);
    await this.prisma.habitLog.deleteMany({ where: { habitId, date: new Date(date) } });
    return { habitId, date };
  }

  // ---- Dashboard ("today") ----

  // Only habits actually scheduled for today are returned (DAILY and
  // WEEKLY_COUNT always are -- the latter's "N times a week" can be done on
  // any day; WEEKLY_DAYS only on a matching weekday). Each habit carries
  // today's own log (if any) and its current streak so the Dashboard can
  // render a checklist without a second round trip per habit.
  async getToday(userId: string) {
    const habits = await this.listHabits(userId, false);
    // The Asia/Dhaka day, as the app dates every check-in.
    const todayKey = dhakaDateKey(new Date());
    const today = new Date(todayKey);
    const logs = await this.prisma.habitLog.findMany({
      where: { habitId: { in: habits.map((h) => h.id) }, date: today },
    });
    const logByHabit = new Map(logs.map((l) => [l.habitId, l]));
    const todayDow = today.getUTCDay();
    const scheduledToday = habits.filter((h) => h.frequencyType !== 'WEEKLY_DAYS' || h.weeklyDays.includes(todayDow));
    const streaks = await this.computeStreaks(habits);

    return scheduledToday.map((h) => ({
      ...h,
      todayLog: logByHabit.get(h.id) ?? null,
      streak: streaks.get(h.id) ?? 0,
    }));
  }

  // Each habit's current streak (see streak.ts): days for a daily or
  // certain-days habit, skipping the days it isn't planned, and weeks for an
  // N-times-a-week one. Today only counts once done, so an unbroken streak
  // doesn't look reset before the day is over.
  private async computeStreaks(habits: Habit[]): Promise<Map<string, number>> {
    const doneByHabit = await this.doneDays(habits);
    const today = dhakaDateKey(new Date());
    return new Map(habits.map((h) => [h.id, currentStreak(h, doneByHabit.get(h.id) ?? new Set(), today)]));
  }

  // Every day each habit was done, as 'YYYY-MM-DD' keys, read in ONE query
  // for all of the habits (no query per habit). Unbounded: a best streak
  // looks at a habit's whole history.
  private async doneDays(habits: Habit[]): Promise<Map<string, Set<string>>> {
    const byHabit = new Map<string, Set<string>>();
    if (habits.length === 0) return byHabit;

    const logs = await this.prisma.habitLog.findMany({
      where: { habitId: { in: habits.map((h) => h.id) }, completed: true },
      select: { habitId: true, date: true },
    });
    for (const log of logs) {
      const set = byHabit.get(log.habitId) ?? new Set<string>();
      set.add(toDateKey(log.date));
      byHabit.set(log.habitId, set);
    }
    return byHabit;
  }

  // ---- Calendar / History ----

  async getMonthLogs(
    userId: string,
    month: string,
  ): Promise<{ habits: Habit[]; logs: { habitId: string; date: Date; completed: boolean; value: number | null }[] }> {
    const habits = await this.listHabits(userId, true);
    const from = new Date(`${month}-01`);
    const to = new Date(from);
    to.setUTCMonth(to.getUTCMonth() + 1);
    const logs = await this.prisma.habitLog.findMany({
      where: { habitId: { in: habits.map((h) => h.id) }, date: { gte: from, lt: to } },
      select: { habitId: true, date: true, completed: true, value: true },
    });
    return { habits, logs };
  }

  // ---- Stats ----

  // One row per active habit. The logs are read in one query for all the
  // habits, and both streaks and the 30-day count come from that read.
  // bestStreak is in currentStreak's unit (weeks for an N-times-a-week habit,
  // days otherwise), over the habit's whole history up to today.
  async getStats(userId: string) {
    const habits = await this.listHabits(userId, false);
    const doneByHabit = await this.doneDays(habits);
    const today = dhakaDateKey(new Date());

    // The 30 Dhaka days ending today. No upper bound, as before: a day
    // logged ahead of today still counts here.
    const last30From = new Date(today);
    last30From.setUTCDate(last30From.getUTCDate() - 29);
    const last30FromKey = toDateKey(last30From);

    return habits.map((h) => {
      const done = doneByHabit.get(h.id) ?? new Set<string>();
      // One log per habit per day (@@unique), so counting days counts logs.
      let last30DaysCompleted = 0;
      for (const day of done) if (day >= last30FromKey) last30DaysCompleted++;
      return {
        habitId: h.id,
        name: h.name,
        icon: h.icon,
        color: h.color,
        currentStreak: currentStreak(h, done, today),
        bestStreak: bestStreak(h, done, today),
        last30DaysCompleted,
        completionRate: Math.round((last30DaysCompleted / 30) * 100),
      };
    });
  }

  private async requireHabit(userId: string, id: string): Promise<Habit> {
    const habit = await this.prisma.habit.findUnique({ where: { id } });
    if (!habit || habit.userId !== userId) {
      throw new NotFoundException('Habit not found');
    }
    return habit;
  }
}
