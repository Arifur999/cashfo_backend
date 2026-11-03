import { BookStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsInt, IsNotEmpty, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { BOOK_COLORS } from '../book-colors.js';
import { trim, whenSent } from '../../common/dto.js';

// Every field is optional -- the same route edits the details, records
// progress (pagesRead) and moves a book between shelves (status).
export class UpdateBookDto {
  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title?: string;

  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  author?: string;

  @ValidateIf(whenSent)
  @IsInt()
  @Min(1)
  @Max(20000)
  totalPages?: number;

  @ValidateIf(whenSent)
  @IsInt()
  @Min(0)
  @Max(20000)
  pagesRead?: number;

  @ValidateIf(whenSent)
  @IsEnum(BookStatus)
  status?: BookStatus;

  @ValidateIf(whenSent)
  @IsIn(BOOK_COLORS)
  color?: string;

  // Put a book being read down for now (its page kept), or take it up again.
  @ValidateIf(whenSent)
  @IsBoolean()
  paused?: boolean;
}
