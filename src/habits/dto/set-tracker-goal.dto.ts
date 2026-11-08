import { IsInt, Max, Min, ValidateIf } from 'class-validator';

// A Namaz month's goal: the share of its prayers aimed for, or null for none.
export class SetTrackerGoalDto {
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(100)
  goalPct: number | null;
}
