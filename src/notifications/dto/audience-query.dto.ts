import { PlatformUserStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Max, Min, ValidateIf } from 'class-validator';
import { whenSent } from '../../common/dto.js';
import { CAMPAIGN_LANGUAGES } from './create-campaign.dto.js';

// The same dimensions a campaign's target filter has, asked about before
// the campaign exists ("about N people match right now").
export class AudienceQueryDto {
  @IsOptional()
  @IsString()
  planId?: string;

  @IsOptional()
  @IsEnum(PlatformUserStatus)
  status?: PlatformUserStatus;

  @ValidateIf(whenSent)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  lastActiveWithinDays?: number;

  @ValidateIf(whenSent)
  @IsIn(CAMPAIGN_LANGUAGES)
  language?: (typeof CAMPAIGN_LANGUAGES)[number];
}
