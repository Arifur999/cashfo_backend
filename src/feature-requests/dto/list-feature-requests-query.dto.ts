import { IsEnum, IsOptional } from 'class-validator';
import { FeatureRequestStatus } from '@prisma/client';

export class ListFeatureRequestsQueryDto {
  @IsOptional()
  @IsEnum(FeatureRequestStatus)
  status?: FeatureRequestStatus;
}
