import { Transform, Type } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { ErrorSource, Severity } from '@prisma/client';
import { trim, whenSent } from '../../common/dto.js';
import { TIME_WINDOWS, type TimeWindow } from '../../common/time-window.js';
import { CUSTOMER_APP } from './report-client-error.dto.js';

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

  // "Last 24 hours" and friends; wins over dateFrom/dateTo.
  @IsOptional()
  @IsIn(TIME_WINDOWS)
  within?: TimeWindow;

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

  // The reference an error screen showed (Next's error digest, kept in
  // metadata.digest): how support finds the row behind the one a customer
  // quotes. Every production Server Components crash has the same message,
  // so the digest is what tells them apart.
  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  digest?: string;

  // Only one app's reports, by metadata.app: the customer app's share the
  // ADMIN_FRONTEND source with the admin panel's. There is no "admin panel
  // only": the panel's reports carry no metadata, and a NOT on a JSON path
  // also drops every row without metadata (SQL NULL), so it would hide them.
  @ValidateIf(whenSent)
  @IsIn([CUSTOMER_APP])
  app?: typeof CUSTOMER_APP;
}
