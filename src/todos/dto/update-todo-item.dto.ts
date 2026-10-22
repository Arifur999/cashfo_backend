import type { TodoPriority } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsString, Matches, MaxLength, ValidateIf, ValidateNested } from 'class-validator';
import { trim, whenSent } from '../../common/dto.js';
import { IsRemindBefore, IsTodoPriority, IsTodoTime, TodoRepeatDto } from './todo-fields.js';

// Every field is optional -- the same route edits the text, ticks the task,
// and saves the Edit task drawer. ValidateIf(whenSent), not IsOptional, so an
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

  // Moves the task to that day's list.
  @ValidateIf(whenSent)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be in YYYY-MM-DD format' })
  date?: string;

  // null stops the task repeating from its own day on.
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @ValidateNested()
  @Type(() => TodoRepeatDto)
  repeat?: TodoRepeatDto | null;
}
