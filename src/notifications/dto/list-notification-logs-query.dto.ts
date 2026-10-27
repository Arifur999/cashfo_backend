import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { NotificationChannel, NotificationLogStatus } from '@prisma/client';

export class ListNotificationLogsQueryDto {
  // The customer's User id (the column keeps its legacy name).
  @IsOptional()
  @IsString()
  platformUserId?: string;

  // What one campaign sent: Campaigns > a campaign's send history.
  @IsOptional()
  @IsString()
  campaignId?: string;

  @IsOptional()
  @IsEnum(NotificationChannel)
  channel?: NotificationChannel;

  @IsOptional()
  @IsEnum(NotificationLogStatus)
  status?: NotificationLogStatus;

  @IsOptional()
  @IsString()
  templateKey?: string;

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
