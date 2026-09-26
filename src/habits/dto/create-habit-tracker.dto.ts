import { IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator';

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
}
