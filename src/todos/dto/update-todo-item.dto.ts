import type { TodoPriority } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsString, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { trim, whenSent } from '../../common/dto.js';
import {
  IsCategoryId,
  IsDayOrNull,
  IsRemindBefore,
  IsTodoNote,
  IsTodoPriority,
  IsTodoSteps,
  IsTodoTime,
  MAX_MOVE_COUNT,
  TodoRepeatDto,
  type TodoStepDto,
} from './todo-fields.js';

// Every field is optional -- the same route edits the text, ticks the task,
// and saves the task popup. ValidateIf(whenSent), not IsOptional, so an
// explicit null still has to be allowed on purpose.
export class UpdateTodoItemDto {
  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  text?: string;

  @ValidateIf(whenSent)
  @IsBoolean()
  completed?: boolean;

  @ValidateIf(whenSent)
  @IsTodoPriority()
  priority?: TodoPriority;

  // null clears the time.
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsTodoTime()
  dueTime?: string | null;

  // null turns the reminder off.
  @IsRemindBefore()
  remindBefore?: number | null;

  // Moves the task to that day's list; null moves it to Someday.
  @IsDayOrNull()
  date?: string | null;

  // null files it back under Personal.
  @IsCategoryId()
  categoryId?: string | null;

  @IsTodoNote()
  note?: string;

  @IsTodoSteps()
  steps?: TodoStepDto[];

  // null stops the task repeating from its own day on.
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @ValidateNested()
  @Type(() => TodoRepeatDto)
  repeat?: TodoRepeatDto | null;

  // Undo of a move: how it stood before (the first day it was planned for,
  // and how often it had been put off).
  @IsDayOrNull()
  movedFrom?: string | null;

  @ValidateIf(whenSent)
  @IsInt()
  @Min(0)
  @Max(MAX_MOVE_COUNT)
  moveCount?: number;
}
