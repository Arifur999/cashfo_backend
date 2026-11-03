import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

// GET /api/books/year: the Asia/Dhaka year Library › Dashboard shows.
export class BookYearQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;
}
