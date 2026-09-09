import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { NotificationChannel, PlatformUserStatus } from '@prisma/client';

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
}

export class CreateCampaignDto {
  @IsString()
  @IsNotEmpty()
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
