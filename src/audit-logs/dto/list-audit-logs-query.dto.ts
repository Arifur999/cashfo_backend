import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListAuditLogsQueryDto {
  @IsOptional()
  @IsString()
  adminUserId?: string;

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  // Deliberately not a validated boolean here -- read as a raw query string
  // in the controller and compared against 'true', same convention as
  // AnnouncementsController's `activeOnly` filter.
  @IsOptional()
  @IsString()
  sensitiveOnly?: string;

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
