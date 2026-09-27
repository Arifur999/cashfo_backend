import { IsInt, IsNotEmpty, IsString, Max, MaxLength, Min } from 'class-validator';

// "Create Challenge" ("Others") -- a free-form name and a day-count goal the
// user picks themselves (no fixed calendar length like Namaz/Ramadan).
export class CreateCustomTrackerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name: string;

  @IsInt()
  @Min(1)
  @Max(365)
  totalDays: number;
}
