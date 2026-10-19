import { GroupKind } from '@prisma/client';
import { IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsUUID, Max, Min, ValidateIf } from 'class-validator';

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
}
