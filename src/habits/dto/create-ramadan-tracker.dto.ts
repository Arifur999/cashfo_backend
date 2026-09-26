import { IsIn, IsInt, Max, Min } from 'class-validator';

// Ramadan is 29 or 30 days depending on the moon sighting, so the user
// picks. The server fixes the category and the month itself.
export class CreateRamadanTrackerDto {
  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;

  @IsIn([29, 30])
  days: number;
}
