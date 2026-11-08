import { TodoPriority, TodoRepeatKind } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { trim } from '../../common/dto.js';

// "HH:MM" on a 24-hour clock.
export const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
export const TIME_MESSAGE = 'dueTime must be a time like 17:30';

// A plain calendar day.
export const DAY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
export const DAY_MESSAGE = 'date must be in YYYY-MM-DD format';

// A reminder at most this many minutes before a task's time.
export const MAX_REMIND_BEFORE = 120;

// A task's note, its smaller steps, and how often it may have been put off.
export const MAX_NOTE_LENGTH = 1000;
export const MAX_STEPS = 20;
export const MAX_STEP_LENGTH = 120;
export const MAX_MOVE_COUNT = 1000;

// The colours a list can take (the board's four built-in ones, then the six a
// new list offers), drawn with the app's tints.
export const TODO_COLORS = ['blue', 'violet', 'orange', 'green', 'pink', 'teal', 'yellow', 'indigo', 'emerald', 'purple'] as const;
export const MAX_CATEGORY_NAME = 30;

// How many minutes before the task's time it reminds (0 = at the time);
// null = no reminder. Only fires while the task has a time.
export const IsRemindBefore = (): PropertyDecorator => (target, key) => {
  for (const decorate of [ValidateIf((_, value) => value !== undefined && value !== null), IsInt(), Min(0), Max(MAX_REMIND_BEFORE)]) decorate(target, key);
};

// A day, or null where null has a meaning of its own (Someday, "never
// moved"); left out = unchanged.
export const IsDayOrNull = (): PropertyDecorator => (target, key) => {
  for (const decorate of [ValidateIf((_, value) => value !== undefined && value !== null), Matches(DAY_REGEX, { message: DAY_MESSAGE })]) decorate(target, key);
};

// A list's id, or null for the built-in Personal list.
export const IsCategoryId = (): PropertyDecorator => (target, key) => {
  for (const decorate of [ValidateIf((_, value) => value !== undefined && value !== null), IsUUID()]) decorate(target, key);
};

// How a task repeats. WEEKLY names its weekdays (0 = Sunday ... 6 =
// Saturday); MONTHLY repeats on the day of the month the task is on.
export class TodoRepeatDto {
  @IsEnum(TodoRepeatKind)
  kind: TodoRepeatKind;

  @ValidateIf((dto: TodoRepeatDto) => dto.kind === TodoRepeatKind.WEEKLY)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekdays?: number[];

  // The repeat's copies remind like this; left out = the task's own
  // remindBefore.
  @IsRemindBefore()
  remindBefore?: number | null;
}

// One smaller step of a task.
export class TodoStepDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_STEP_LENGTH)
  text: string;

  @IsBoolean()
  done: boolean;
}

// A task's steps, in order; the whole list is sent each time.
export const IsTodoSteps = (): PropertyDecorator => (target, key) => {
  for (const decorate of [
    ValidateIf((_, value) => value !== undefined),
    IsArray(),
    ArrayMaxSize(MAX_STEPS),
    ValidateNested({ each: true }),
    Type(() => TodoStepDto),
  ])
    decorate(target, key);
};

// A task's note: a few lines, up to MAX_NOTE_LENGTH characters.
export const IsTodoNote = (): PropertyDecorator => (target, key) => {
  for (const decorate of [ValidateIf((_, value) => value !== undefined), IsString(), MaxLength(MAX_NOTE_LENGTH)]) decorate(target, key);
};

// Shared decorators for a task's priority and time.
export const IsTodoPriority = () => IsEnum(TodoPriority);
export const IsTodoTime = () => Matches(TIME_REGEX, { message: TIME_MESSAGE });
