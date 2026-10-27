import { IsISO8601, IsNotEmpty, IsString, MinLength, ValidateIf } from 'class-validator';

export class ChangeOwnerPlanDto {
  @IsString()
  @IsNotEmpty()
  newPlanId: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  reason: string;

  // When a paid plan ends. Left out: a running paid period keeps its end,
  // otherwise the plan never expires. null: it never expires.
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsISO8601()
  currentPeriodEnd?: string | null;
}
