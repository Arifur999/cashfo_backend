import { IsBoolean, IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator';

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
}
