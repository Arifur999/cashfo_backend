import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ChangeOwnerPlanDto {
  @IsString()
  @IsNotEmpty()
  newPlanId: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  reason: string;
}
