import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { trim, whenSent } from '../../common/dto.js';

// "Create Challenge" ("Others") -- a free-form name and a day-count goal the
// user picks themselves (no fixed calendar length like Namaz/Ramadan).
export class CreateCustomTrackerDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name: string;

  @IsInt()
  @Min(1)
  @Max(365)
  totalDays: number;

  // Day 1 is tomorrow rather than today.
  @ValidateIf(whenSent)
  @IsBoolean()
  startsTomorrow?: boolean;
}
