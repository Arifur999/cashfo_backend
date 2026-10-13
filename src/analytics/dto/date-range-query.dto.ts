import { IsISO8601, IsOptional, Matches } from 'class-validator';

// Calendar days, as the range picker sends them. IsDateString alone let
// through forms like 2026-W10 that `new Date()` can't read.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class DateRangeQueryDto {
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'from must be a date in YYYY-MM-DD form' })
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'to must be a date in YYYY-MM-DD form' })
  @IsISO8601({ strict: true })
  to?: string;
}
