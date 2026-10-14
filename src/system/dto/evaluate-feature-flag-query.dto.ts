import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class EvaluateFeatureFlagQueryDto {
  @IsString()
  @IsNotEmpty()
  key: string;

  // Ignored -- the flag is evaluated for the signed-in customer. Still
  // accepted so an older client sending it gets an answer, not a 400.
  @IsOptional()
  @IsString()
  platformUserId?: string;
}
