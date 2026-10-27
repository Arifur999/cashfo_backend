import { DateStyle, DigitStyle, NumberGrouping, WeekStart } from '@prisma/client';
import { IsEnum, ValidateIf } from 'class-validator';
import { whenSent } from '../../common/dto.js';

// PATCH /api/auth/preferences (Settings > App > Numbers and dates). Send
// only what changes. digitStyle may be null: follow the language again.
export class UpdatePreferencesDto {
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsEnum(DigitStyle)
  digitStyle?: DigitStyle | null;

  @ValidateIf(whenSent)
  @IsEnum(NumberGrouping)
  numberGrouping?: NumberGrouping;

  @ValidateIf(whenSent)
  @IsEnum(DateStyle)
  dateStyle?: DateStyle;

  @ValidateIf(whenSent)
  @IsEnum(WeekStart)
  weekStart?: WeekStart;
}
