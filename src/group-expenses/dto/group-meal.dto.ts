import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDateString, IsInt, IsNumber, IsUUID, Max, Min, ValidateNested } from 'class-validator';

// One member's meals on a day; all zero clears the day.
export class GroupMealEntryDto {
  @IsUUID()
  groupMemberId: string;

  @IsInt()
  @Min(0)
  @Max(5)
  breakfast: number;

  @IsInt()
  @Min(0)
  @Max(5)
  lunch: number;

  @IsInt()
  @Min(0)
  @Max(5)
  dinner: number;

  // Meals eaten by their guests, in meal units.
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(50)
  guests: number;
}

// A day's meals for some or all of the members.
export class SetGroupMealsDto {
  @IsDateString()
  date: string;

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => GroupMealEntryDto)
  entries: GroupMealEntryDto[];
}
