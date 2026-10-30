import { GroupKind } from '@prisma/client';
import { IsBoolean, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsUUID, Max, Min, ValidateIf } from 'class-validator';
import { whenSent } from '../../common/dto.js';

// Any of a group's settings; the rest stay as they are.
export class UpdateGroupSettingsDto {
  @IsOptional()
  @IsEnum(GroupKind)
  kind?: GroupKind;

  // A month can start on any day up to the 28th, which every month has.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  monthStartDay?: number;

  // null: nobody in particular holds the cash.
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsUUID()
  cashHolderMemberId?: string | null;

  @IsOptional()
  @IsBoolean()
  mealsOn?: boolean;

  // What each meal counts for (a breakfast is often half a meal).
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(5)
  breakfastUnits?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(5)
  lunchUnits?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(5)
  dinnerUnits?: number;

  // Warn once this much of a month's budget is spent; null = never.
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsIn([80, 90, 100])
  budgetWarnPercent?: number | null;

  // Pause the group (kept out of new entries) or resume it.
  @ValidateIf(whenSent)
  @IsBoolean()
  paused?: boolean;
}
