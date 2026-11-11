import { IsBoolean, IsInt, Matches, Max, Min, ValidateIf } from 'class-validator';
import { whenSent } from '../../common/dto.js';

export const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

// Reading now's "Log today's reading": the day (today or an earlier one) and
// the page read up to; the page it began on is the book's own.
export class LogReadingDto {
  @Matches(DAY, { message: 'date must look like 2026-11-14' })
  date: string;

  @IsInt()
  @Min(1)
  @Max(20000)
  toPage: number;

  // At the last page: mark the book finished too (the board's checkbox).
  @ValidateIf(whenSent)
  @IsBoolean()
  finish?: boolean;
}
