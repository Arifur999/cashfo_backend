import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { ErrorSource, Severity } from '@prisma/client';
import { trim, whenSent } from '../../common/dto.js';
import { CUSTOMER_APP } from './report-client-error.dto.js';
import { TIME_WINDOWS, type TimeWindow } from '../../common/time-window.js';

// System > Errors, grouped: the same message from the same source is one
// row ("TypeError: ... x5 times").
export class ErrorGroupsQueryDto {
  // 'false' (the page's "Not fixed") counts only unresolved rows; 'true'
  // only resolved ones; left out, every row.
  @ValidateIf(whenSent)
  @IsIn(['true', 'false'])
  resolved?: 'true' | 'false';

  @ValidateIf(whenSent)
  @IsEnum(ErrorSource)
  source?: ErrorSource;

  // Rows of this severity only.
  @ValidateIf(whenSent)
  @IsEnum(Severity)
  severity?: Severity;

  // The reference an error screen showed (metadata.digest), as the plain
  // list takes it.
  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  digest?: string;

  // Only the customer app's reports (metadata.app), as the plain list.
  @ValidateIf(whenSent)
  @IsIn([CUSTOMER_APP])
  app?: typeof CUSTOMER_APP;

  // "Last 24 hours" and friends; wins over from/to.
  @ValidateIf(whenSent)
  @IsIn(TIME_WINDOWS)
  within?: TimeWindow;

  @ValidateIf(whenSent)
  @IsDateString()
  from?: string;

  @ValidateIf(whenSent)
  @IsDateString()
  to?: string;

  @ValidateIf(whenSent)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ValidateIf(whenSent)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

// "Mark all 5 fixed": every unresolved row of one group (message + source),
// or the rows named by id. At least one of the three is required (the
// service checks), so an empty body can't mark every error fixed.
export class ResolveErrorsDto {
  // Exact match, as the group showed it. Not trimmed: a stored message keeps
  // its own spacing.
  @ValidateIf(whenSent)
  @IsString()
  @IsNotEmpty()
  @MaxLength(10_000)
  message?: string;

  @ValidateIf(whenSent)
  @IsEnum(ErrorSource)
  source?: ErrorSource;

  @ValidateIf(whenSent)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids?: string[];
}
