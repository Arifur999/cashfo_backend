import { PlatformUserStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

// The same two dimensions a campaign's target filter has, asked about
// before the campaign exists ("about N people match right now").
export class AudienceQueryDto {
  @IsOptional()
  @IsString()
  planId?: string;

  @IsOptional()
  @IsEnum(PlatformUserStatus)
  status?: PlatformUserStatus;
}
