import { IsEnum, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import { DeviceType } from '@prisma/client';

export class TrackEventDto {
  @IsString()
  @IsNotEmpty()
  platformUserId: string;

  @IsString()
  @IsNotEmpty()
  eventType: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsEnum(DeviceType)
  deviceType: DeviceType;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  city?: string;
}
