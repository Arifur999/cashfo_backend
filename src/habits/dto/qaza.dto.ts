import { IsIn, IsInt, Matches, Max, Min, ValidateIf } from 'class-validator';
import { whenSent } from '../../common/dto.js';
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
