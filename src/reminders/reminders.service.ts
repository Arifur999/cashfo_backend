import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Reminder, ReminderKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ReminderSettingsDto, UpsertReminderDto } from './dto/reminder.dto.js';
import { isNamazKey, isRamadanKey, isTimedKind } from './fire-times.js';

export interface ReminderView {
  id: string;
  kind: ReminderKind;
  targetKey: string;
  enabled: boolean;
  times: string[];
  weekdays: number[];
  minutesBefore: number;
  createdAt: Date;
  updatedAt: Date;
}

const toView = (row: Reminder): ReminderView => ({
  id: row.id,
  kind: row.kind,
  targetKey: row.targetKey,
  enabled: row.enabled,
  times: row.times,
  weekdays: row.weekdays,
  minutesBefore: row.minutesBefore,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

// The Habit Tracker's reminders (RemindersScheduler fires them) and their
// master switch.
@Injectable()
export class RemindersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<{ remindHabits: boolean; reminders: ReminderView[] }> {
    const [user, reminders] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { remindHabits: true } }),
      this.prisma.reminder.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    ]);
    return { remindHabits: user.remindHabits, reminders: reminders.map(toView) };
  }

  async upsert(userId: string, dto: UpsertReminderDto): Promise<ReminderView> {
    await this.requireTarget(userId, dto.kind, dto.targetKey);
    const where = { userId_kind_targetKey: { userId, kind: dto.kind, targetKey: dto.targetKey } };

    if (!isTimedKind(dto.kind)) {
      // NAMAZ/RAMADAN fire from the day's computed times: no clock of their own.
      const fields = { enabled: dto.enabled, times: [], weekdays: [], ...(dto.minutesBefore !== undefined && { minutesBefore: dto.minutesBefore }) };
      return toView(await this.prisma.reminder.upsert({ where, create: { userId, kind: dto.kind, targetKey: dto.targetKey, ...fields }, update: fields }));
    }

    const existing = await this.prisma.reminder.findUnique({ where });
    const times = [...(dto.times ?? existing?.times ?? [])].sort();
    const weekdays = [...(dto.weekdays ?? existing?.weekdays ?? [])].sort((a, b) => a - b);
    if (times.length === 0 && (dto.enabled || dto.times !== undefined)) throw new BadRequestException('Pick at least one time');
    const fields = { enabled: dto.enabled, times, weekdays, ...(dto.minutesBefore !== undefined && { minutesBefore: dto.minutesBefore }) };
    return toView(await this.prisma.reminder.upsert({ where, create: { userId, kind: dto.kind, targetKey: dto.targetKey, ...fields }, update: fields }));
  }

  async remove(userId: string, id: string): Promise<{ ok: true }> {
    const { count } = await this.prisma.reminder.deleteMany({ where: { id, userId } });
    if (count === 0) throw new NotFoundException('Reminder not found');
    return { ok: true };
  }

  async setSettings(userId: string, dto: ReminderSettingsDto): Promise<{ remindHabits: boolean }> {
    const user = await this.prisma.user.update({ where: { id: userId }, data: { remindHabits: dto.remindHabits }, select: { remindHabits: true } });
    return { remindHabits: user.remindHabits };
  }

  // What a reminder is for must be the caller's own (a habit, challenge,
  // book or skill), or a prayer / Sehri / Iftar.
  private async requireTarget(userId: string, kind: ReminderKind, targetKey: string): Promise<void> {
    let found: unknown;
    switch (kind) {
      case 'HABIT':
        found = await this.prisma.habit.findFirst({ where: { id: targetKey, userId, isArchived: false }, select: { id: true } });
        if (!found) throw new NotFoundException('Habit not found');
        return;
      case 'CHALLENGE':
        found = await this.prisma.habitMonthTracker.findFirst({ where: { id: targetKey, userId, category: 'Others' }, select: { id: true } });
        if (!found) throw new NotFoundException('Challenge not found');
        return;
      case 'BOOK':
        found = await this.prisma.book.findFirst({ where: { id: targetKey, userId }, select: { id: true } });
        if (!found) throw new NotFoundException('Book not found');
        return;
      case 'SKILL':
        found = await this.prisma.skill.findFirst({ where: { id: targetKey, userId, deletedAt: null }, select: { id: true } });
        if (!found) throw new NotFoundException('Skill not found');
        return;
      case 'NAMAZ':
        if (!isNamazKey(targetKey)) throw new BadRequestException('targetKey must be one of fajr, dhuhr, asr, maghrib, isha');
        return;
      case 'RAMADAN':
        if (!isRamadanKey(targetKey)) throw new BadRequestException('targetKey must be sehri or iftar');
        return;
      case 'TODO':
        throw new BadRequestException("A to-do's reminder is set on the task itself (remindBefore)");
    }
  }
}
