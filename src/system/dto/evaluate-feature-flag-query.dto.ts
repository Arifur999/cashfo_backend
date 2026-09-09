import { IsNotEmpty, IsString } from 'class-validator';

export class EvaluateFeatureFlagQueryDto {
  @IsString()
  @IsNotEmpty()
  key: string;

  @IsString()
  @IsNotEmpty()
  platformUserId: string;
}
