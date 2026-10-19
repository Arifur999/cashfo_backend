import { PrayerStatus } from '@prisma/client';
import { IsBoolean, IsEnum, IsInt, IsNotEmpty, IsString, Max, Min, ValidateIf } from 'class-validator';
import { whenSent } from '../../common/dto.js';

export class SetHabitTrackerCheckDto {
  // A broad sanity bound only -- the exact per-tracker limit (31 for a
  // calendar month, 29/30 for Ramadan, up to 365 for an Others challenge) is
  // enforced by HabitTrackersService.setCheck()'s own sheetDays() check.
  @IsInt()
  @Min(1)
  @Max(365)
  day: number;

  @IsString()
  @IsNotEmpty()
  item: string;

  @IsBoolean()
  checked: boolean;

  // Namaz only: how the prayer was prayed (MISSED = an explicit "not
  // prayed"). Left out, a new mark is ON_TIME and an old one keeps its own.
  @ValidateIf(whenSent)
  @IsEnum(PrayerStatus)
  status?: PrayerStatus;
}
