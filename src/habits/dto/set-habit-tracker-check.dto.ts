import { IsBoolean, IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator';

export class SetHabitTrackerCheckDto {
  @IsInt()
  @Min(1)
  @Max(31)
  day: number;

  @IsString()
  @IsNotEmpty()
  item: string;

  @IsBoolean()
  checked: boolean;
}
