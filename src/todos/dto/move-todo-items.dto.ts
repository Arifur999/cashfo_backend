import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsUUID, Matches, ValidateIf } from 'class-validator';
import { DAY_MESSAGE, DAY_REGEX } from './todo-fields.js';

// Several tasks to one day at once (the board's "Move all to today"), or to
// Someday (date null).
export class MoveTodoItemsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  itemIds: string[];

  @ValidateIf((_, value) => value !== null)
  @Matches(DAY_REGEX, { message: DAY_MESSAGE })
  date: string | null;
}
