import { IsEnum } from 'class-validator';
import { FeatureRequestStatus } from '@prisma/client';

export class UpdateFeatureRequestDto {
  @IsEnum(FeatureRequestStatus)
  status: FeatureRequestStatus;
}
