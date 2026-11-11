import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { trim } from '../../common/dto.js';
import { MAX_CATEGORY_NAME, TODO_COLORS } from './todo-fields.js';

// A list the person adds beside Personal, Work, Home and Deen.
export class CreateTodoCategoryDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_CATEGORY_NAME)
  name: string;

  @IsIn(TODO_COLORS)
  color: (typeof TODO_COLORS)[number];
}
