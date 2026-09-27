import { BookStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsNotEmpty, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { BOOK_COLORS } from '../book-colors.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

// ValidateIf(v !== undefined), not IsOptional: IsOptional also skips an
// explicit null, which would then reach the service as a value (a null title
// would crash it, a null status would count as "moved to a shelf").
const whenSent = (_: unknown, value: unknown) => value !== undefined;

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
}
