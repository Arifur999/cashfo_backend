import { Transform, Type } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { NotificationChannel, PlatformUserStatus } from '@prisma/client';
import { trim, whenSent } from '../../common/dto.js';

export const CAMPAIGN_LANGUAGES = ['EN', 'BN'] as const;

// Deliberately a small, known shape (not raw JSON from the admin) --
// PART C's frontend spec explicitly wants dropdown-built filters, not a
// JSON textarea. Extend this as more filter dimensions are needed later.
export class TargetFilterDto {
  @IsOptional()
  @IsString()
  planId?: string;

  @IsOptional()
  @IsEnum(PlatformUserStatus)
  status?: PlatformUserStatus;

  // "Last active within N days": signed in within that many days.
  @ValidateIf(whenSent)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  lastActiveWithinDays?: number;

  // The app language the person picked; left out = any.
  @ValidateIf(whenSent)
  @IsIn(CAMPAIGN_LANGUAGES)
  language?: (typeof CAMPAIGN_LANGUAGES)[number];
}

export class CreateCampaignDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsString()
  @IsNotEmpty()
  templateKey: string;

  @ValidateNested()
  @Type(() => TargetFilterDto)
  targetFilter: TargetFilterDto;

  @IsEnum(NotificationChannel)
  channel: NotificationChannel;

  @IsOptional()
  @IsDateString()
  scheduledFor?: string;
}
