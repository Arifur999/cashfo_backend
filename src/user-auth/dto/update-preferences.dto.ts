import { DateStyle, DigitStyle, FiscalYearStart, NumberGrouping, StartPage, WeekStart } from '@prisma/client';
import { IsBoolean, IsEnum, IsIn, ValidateIf } from 'class-validator';
import { whenSent } from '../../common/dto.js';

// PATCH /api/auth/preferences (Settings › App preferences). Send only what
// changes. digitStyle may be null: follow the language again.
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

  @ValidateIf(whenSent)
  @IsBoolean()
  roundAmounts?: boolean;

  @ValidateIf(whenSent)
  @IsEnum(StartPage)
  startPage?: StartPage;

  @ValidateIf(whenSent)
  @IsIn([10, 20, 50])
  rowsPerPage?: number;

  @ValidateIf(whenSent)
  @IsBoolean()
  compactTables?: boolean;

  @ValidateIf(whenSent)
  @IsBoolean()
  sidebarCollapsed?: boolean;

  @ValidateIf(whenSent)
  @IsEnum(FiscalYearStart)
  fiscalYearStart?: FiscalYearStart;

  @ValidateIf(whenSent)
  @IsBoolean()
  showHijri?: boolean;
}
