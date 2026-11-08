import { BookStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsNotEmpty, IsNumber, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { BOOK_COLORS } from '../book-colors.js';
import { trim, whenSent } from '../../common/dto.js';

// The most a price may be: the LibraryBooks board's "That price looks too big".
export const MAX_BOOK_PRICE = 1_000_000;

export class CreateBookDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title: string;

  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  author?: string;

  @IsInt()
  @Min(1)
  @Max(20000)
  totalPages: number;

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

  // What the reader paid, in taka; null or left out when they don't remember.
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MAX_BOOK_PRICE)
  price?: number | null;

  // A built-in shelf key or the id of one of the reader's own shelves
  // (checked by the service).
  @ValidateIf(whenSent)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  shelf?: string;
}
