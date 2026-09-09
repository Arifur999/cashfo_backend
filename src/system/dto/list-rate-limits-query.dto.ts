import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListRateLimitsQueryDto {
  // Raw string, compared against 'true'/'false' in the controller -- same
  // convention as AnnouncementsController's `activeOnly` filter.
  @IsOptional()
  @IsString()
  limitExceeded?: string;

  @IsOptional()
  @IsString()
  endpoint?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
