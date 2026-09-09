import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ChangePlanDto {
  @IsString()
  @IsNotEmpty()
  newPlanId: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  reason: string;
}
