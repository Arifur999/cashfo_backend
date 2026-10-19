import { AsrSchool } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsNumber, IsString, Length, Matches, Max, Min, ValidateIf } from 'class-validator';
import { trim, whenSent } from '../../common/dto.js';
import { NAMAZ_PRAYERS } from '../habit-trackers.service.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MESSAGE = 'must be in YYYY-MM-DD format';

// "I prayed a qaza": which prayer, how many at once, and the day (today when
// left out).
export class LogQazaDto {
  @IsIn(NAMAZ_PRAYERS)
  prayer: string;

  @ValidateIf(whenSent)
  @IsInt()
  @Min(1)
  @Max(50)
  count?: number;

  @ValidateIf(whenSent)
  @Matches(DAY, { message: `date ${DAY_MESSAGE}` })
  date?: string;
}

// The day qaza counting starts from.
export class SetQazaSinceDto {
  @Matches(DAY, { message: `since ${DAY_MESSAGE}` })
  since: string;
}

// The adhan calculation methods a person can pick.
export const PRAYER_METHODS = ['Karachi', 'MuslimWorldLeague', 'Egyptian', 'UmmAlQura', 'Dubai', 'Qatar', 'Kuwait', 'Singapore', 'Turkey', 'Tehran', 'NorthAmerica', 'MoonsightingCommittee'];

// Where and how prayer times are worked out. Every field is optional; a
// city comes with its coordinates.
export class UpdatePrayerSettingsDto {
  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  city?: string;

  @ValidateIf(whenSent)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ValidateIf(whenSent)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ValidateIf(whenSent)
  @IsIn(PRAYER_METHODS)
  method?: string;

  @ValidateIf(whenSent)
  @IsEnum(AsrSchool)
  asrSchool?: AsrSchool;

  @ValidateIf(whenSent)
  @IsInt()
  @Min(-1)
  @Max(1)
  hijriAdjust?: number;
}
