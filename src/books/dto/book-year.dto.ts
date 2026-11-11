import { Type } from 'class-transformer';
import { IsInt, Matches, Max, Min } from 'class-validator';
import { DAY } from './log-reading.dto.js';

// GET /api/books/year: the Asia/Dhaka year Library › Dashboard shows.
export class BookYearQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;
}

// GET /api/books/pages: the pages read from one day to another, both in.
export class BookPagesQueryDto {
  @Matches(DAY, { message: 'from must look like 2026-11-14' })
  from: string;

  @Matches(DAY, { message: 'to must look like 2026-11-14' })
  to: string;
}
