import { Injectable, NotFoundException } from '@nestjs/common';
import { Habit } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CheckInHabitDto } from './dto/check-in-habit.dto.js';
import { CreateHabitDto } from './dto/create-habit.dto.js';
import { UpdateHabitDto } from './dto/update-habit.dto.js';

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

@Injectable()
export class HabitsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Habits ----

  listHabits(userId: string, includeArchived = false) {
    return this.prisma.habit.findMany({
      where: { userId, ...(includeArchived ? {} : { isArchived: false }) },
      orderBy: { createdAt: 'asc' },
    });
  }

  createHabit(userId: string, dto: CreateHabitDto) {
    return this.prisma.habit.create({
      data: {
        userId,
        name: dto.name,
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
    const todayKey = toDateKey(new Date());
    const today = new Date(todayKey);
    const logs = await this.prisma.habitLog.findMany({
      where: { habitId: { in: habits.map((h) => h.id) }, date: today },
    });
    const logByHabit = new Map(logs.map((l) => [l.habitId, l]));
    const todayDow = today.getUTCDay();
    const scheduledToday = habits.filter((h) => h.frequencyType !== 'WEEKLY_DAYS' || h.weeklyDays.includes(todayDow));
    const streaks = await this.computeStreaks(habits.map((h) => h.id));

    return scheduledToday.map((h) => ({
      ...h,
      todayLog: logByHabit.get(h.id) ?? null,
      streak: streaks.get(h.id) ?? 0,
    }));
  }

  // Consecutive completed days counting backward from today -- if today
  // isn't logged yet, counting starts from yesterday instead so an
  // unbroken streak doesn't look reset to 0 before the day is even over.
  private async computeStreaks(habitIds: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (habitIds.length === 0) return result;

    const logs = await this.prisma.habitLog.findMany({
      where: { habitId: { in: habitIds }, completed: true },
      select: { habitId: true, date: true },
    });
    const dateKeysByHabit = new Map<string, Set<string>>();
    for (const log of logs) {
      const set = dateKeysByHabit.get(log.habitId) ?? new Set<string>();
      set.add(toDateKey(log.date));
      dateKeysByHabit.set(log.habitId, set);
    }

    for (const habitId of habitIds) {
      const dateKeys = dateKeysByHabit.get(habitId);
      if (!dateKeys) {
        result.set(habitId, 0);
        continue;
      }
      const cursor = new Date(toDateKey(new Date()));
      if (!dateKeys.has(toDateKey(cursor))) {
        cursor.setUTCDate(cursor.getUTCDate() - 1);
      }
      let streak = 0;
      while (dateKeys.has(toDateKey(cursor))) {
        streak++;
        cursor.setUTCDate(cursor.getUTCDate() - 1);
      }
      result.set(habitId, streak);
    }
    return result;
  }

  // ---- Calendar / History ----

  async getMonthLogs(userId: string, month: string): Promise<{ habits: Habit[]; logs: { habitId: string; date: Date; completed: boolean; value: number | null }[] }> {
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

  async getStats(userId: string) {
    const habits = await this.listHabits(userId, false);
    const streaks = await this.computeStreaks(habits.map((h) => h.id));

    const last30From = new Date(toDateKey(new Date()));
    last30From.setUTCDate(last30From.getUTCDate() - 29);
    const logs = await this.prisma.habitLog.findMany({
      where: { habitId: { in: habits.map((h) => h.id) }, date: { gte: last30From }, completed: true },
      select: { habitId: true },
    });
    const countByHabit = new Map<string, number>();
    for (const log of logs) {
      countByHabit.set(log.habitId, (countByHabit.get(log.habitId) ?? 0) + 1);
    }

    return habits.map((h) => ({
      habitId: h.id,
      name: h.name,
      icon: h.icon,
      color: h.color,
      currentStreak: streaks.get(h.id) ?? 0,
      last30DaysCompleted: countByHabit.get(h.id) ?? 0,
      completionRate: Math.round(((countByHabit.get(h.id) ?? 0) / 30) * 100),
    }));
  }

  private async requireHabit(userId: string, id: string): Promise<Habit> {
    const habit = await this.prisma.habit.findUnique({ where: { id } });
    if (!habit || habit.userId !== userId) {
      throw new NotFoundException('Habit not found');
    }
    return habit;
  }
}
