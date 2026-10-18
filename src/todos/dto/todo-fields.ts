import { TodoPriority, TodoRepeatKind } from '@prisma/client';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsEnum, IsInt, Matches, Max, Min, ValidateIf } from 'class-validator';

// "HH:MM" on a 24-hour clock.
export const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
export const TIME_MESSAGE = 'dueTime must be a time like 17:30';

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
}


// Shared decorators for a task's priority and time.
export const IsTodoPriority = () => IsEnum(TodoPriority);
export const IsTodoTime = () => Matches(TIME_REGEX, { message: TIME_MESSAGE });
