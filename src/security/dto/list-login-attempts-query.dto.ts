import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListLoginAttemptsQueryDto {
  @IsOptional()
  @IsString()
  email?: string;

  // Raw string, compared against 'true'/'false' in the controller -- same
  // convention as AnnouncementsController's `activeOnly` filter.
  @IsOptional()
  @IsString()
  success?: string;

  @IsOptional()
  @IsString()
  ipAddress?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

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
