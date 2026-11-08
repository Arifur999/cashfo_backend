import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsISO8601, IsUUID, Matches, Max, Min, ValidateIf, ValidateNested } from 'class-validator';
import { whenSent } from '../../common/dto.js';
import { CreateTodoItemDto } from './create-todo-item.dto.js';
import { DAY_MESSAGE, DAY_REGEX, IsDayOrNull, MAX_MOVE_COUNT, TodoRepeatDto } from './todo-fields.js';

// A task added straight to a day, or to Someday (date null), with its list
// made on the way. The last few fields put back a task that was just
// deleted (the board's Undo): as it was, ticked or not, put off or not, and
// on its repeating rule.
export class CreateTaskDto extends CreateTodoItemDto {
  // Required: a day, or null for Someday.
  @ValidateIf((_, value) => value !== null)
  @Matches(DAY_REGEX, { message: DAY_MESSAGE })
  date: string | null;

  @ValidateIf(whenSent)
  @ValidateNested()
  @Type(() => TodoRepeatDto)
  repeat?: TodoRepeatDto;

  @ValidateIf(whenSent)
  @IsBoolean()
  completed?: boolean;

  // When a restored task was ticked off; only with completed.
  @ValidateIf(whenSent)
  @IsISO8601({ strict: true })
  completedAt?: string;

  @IsDayOrNull()
  movedFrom?: string | null;

  @ValidateIf(whenSent)
  @IsInt()
  @Min(0)
  @Max(MAX_MOVE_COUNT)
  moveCount?: number;

  // The repeating rule a restored copy belonged to.
  @ValidateIf(whenSent)
  @IsUUID()
  repeatId?: string;
}
