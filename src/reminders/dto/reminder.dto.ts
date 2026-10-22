import { ReminderKind } from '@prisma/client';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsEnum, IsInt, IsNotEmpty, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { trim, whenSent } from '../../common/dto.js';
import { CLOCK_REGEX } from '../fire-times.js';

export const MAX_TIMES = 6;
export const MAX_MINUTES_BEFORE = 120;

// PUT /api/reminders: turns one reminder on or off, or changes when it
// fires. One per (kind, targetKey); saving again replaces it. To-do
// reminders are set on the task itself (remindBefore), not here.
export class UpsertReminderDto {
  @IsEnum(ReminderKind)
  kind: ReminderKind;

  // A Habit, challenge, Book or Skill id; a prayer ("fajr" ... "isha"); or
  // "sehri" / "iftar".
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  targetKey: string;

  @IsBoolean()
  enabled: boolean;

  // HABIT/CHALLENGE/BOOK/SKILL: "HH:MM" (Dhaka), up to six; at least one
  // once the reminder exists (the service checks). Ignored for NAMAZ/RAMADAN.
  @ValidateIf(whenSent)
  @IsArray()
  @ArrayMaxSize(MAX_TIMES)
  @ArrayUnique()
  @Matches(CLOCK_REGEX, { each: true, message: 'each time must be like 07:30' })
  times?: string[];

  // 0 = Sunday ... 6 = Saturday; empty = every day.
  @ValidateIf(whenSent)
  @IsArray()
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekdays?: number[];

  // NAMAZ/RAMADAN: how many minutes before the time (0 = at the time).
  @ValidateIf(whenSent)
  @IsInt()
  @Min(0)
  @Max(MAX_MINUTES_BEFORE)
  minutesBefore?: number;
}

// PUT /api/reminders/settings: the master switch.
export class ReminderSettingsDto {
  @IsBoolean()
  remindHabits: boolean;
}
