import { IsInt, IsNotEmpty, IsString, Max, Min, ValidateIf } from 'class-validator';

export class CreateHabitTrackerDto {
  @IsString()
  @IsNotEmpty()
  category: string;

  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;

  // Namaz: the share of the month's prayers aimed for; null or left out = none.
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsInt()
  @Min(1)
  @Max(100)
  goalPct?: number | null;
}
