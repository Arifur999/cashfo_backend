import type { TodoPriority } from '@prisma/client';
import { IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';
import { whenSent } from '../../common/dto.js';
import { IsTodoPriority, IsTodoTime } from './todo-fields.js';

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
}
