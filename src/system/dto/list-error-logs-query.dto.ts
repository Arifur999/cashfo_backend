import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ErrorSource, Severity } from '@prisma/client';

export class ListErrorLogsQueryDto {
  @IsOptional()
  @IsEnum(ErrorSource)
  source?: ErrorSource;

  @IsOptional()
  @IsEnum(Severity)
  severity?: Severity;

  // Raw string, compared against 'true'/'false' in the controller -- same
  // convention as AnnouncementsController's `activeOnly` filter.
  @IsOptional()
  @IsString()
  resolved?: string;

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
