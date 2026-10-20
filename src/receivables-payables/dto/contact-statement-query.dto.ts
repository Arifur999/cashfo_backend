import { Type } from 'class-transformer';
import { IsInt, IsISO8601, Matches, Max, Min, ValidateIf } from 'class-validator';
import { whenSent } from '../../common/dto.js';

// Calendar days, as the date pickers send them. IsISO8601 alone let through
// forms like 2026-W10 that `new Date()` can't read.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'must be a date in YYYY-MM-DD form';

export class ContactStatementQueryDto {
  @ValidateIf(whenSent)
  @Matches(DATE_ONLY, { message: `dateFrom ${DATE_MESSAGE}` })
  @IsISO8601({ strict: true })
  dateFrom?: string;

  @ValidateIf(whenSent)
  @Matches(DATE_ONLY, { message: `dateTo ${DATE_MESSAGE}` })
  @IsISO8601({ strict: true })
  dateTo?: string;

  @ValidateIf(whenSent)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  // Rows a page; 50 when left out.
  @ValidateIf(whenSent)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
