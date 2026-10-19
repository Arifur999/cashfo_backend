import { IsInt, Max, Min } from 'class-validator';

// The paras of the Quran read on one day of a Ramadan sheet; 0 clears the day.
export class SetRamadanParasDto {
  // The exact bound (29 or 30) is the sheet's own, checked by the service.
  @IsInt()
  @Min(1)
  @Max(30)
  day: number;

  @IsInt()
  @Min(0)
  @Max(30)
  paras: number;
}
