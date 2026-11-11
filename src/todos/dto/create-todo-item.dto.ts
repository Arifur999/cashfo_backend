import type { TodoPriority } from '@prisma/client';
import { IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';
import { whenSent } from '../../common/dto.js';
import { IsCategoryId, IsRemindBefore, IsTodoNote, IsTodoPriority, IsTodoSteps, IsTodoTime, type TodoStepDto } from './todo-fields.js';

export class CreateTodoItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  text: string;

  @ValidateIf(whenSent)
  @IsTodoPriority()
  priority?: TodoPriority;

  // null or left out = any time that day.
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsTodoTime()
  dueTime?: string | null;

  // null or left out = no reminder.
  @IsRemindBefore()
  remindBefore?: number | null;

  // The list it is filed under; null or left out = Personal.
  @IsCategoryId()
  categoryId?: string | null;

  @IsTodoNote()
  note?: string;

  @IsTodoSteps()
  steps?: TodoStepDto[];
}
