import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { trim, whenSent } from '../../common/dto.js';

// A note on a book, or a line the reader liked, and the page it came from.
export class CreateBookNoteDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  text: string;

  @ValidateIf(whenSent)
  @IsInt()
  @Min(1)
  @Max(20000)
  page?: number;
}
