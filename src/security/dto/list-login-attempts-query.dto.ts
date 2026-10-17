import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { LOGIN_WINDOWS, type LoginWindow } from '../security-extras.js';

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

  // "Last 24 hours" and friends; wins over dateFrom/dateTo when both are sent.
  @IsOptional()
  @IsIn(Object.keys(LOGIN_WINDOWS))
  within?: LoginWindow;

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
