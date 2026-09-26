import { HabitFrequency } from '@prisma/client';
import { IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';
import { BUDGET_CATEGORY_COLORS, BUDGET_CATEGORY_ICONS } from '../../budgets/budget-category-visuals.js';

export class UpdateHabitDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsIn(BUDGET_CATEGORY_ICONS)
  icon?: string;

  @IsOptional()
  @IsIn(BUDGET_CATEGORY_COLORS)
  color?: string;

  @IsOptional()
  @IsEnum(HabitFrequency)
  frequencyType?: HabitFrequency;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weeklyDays?: number[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  weeklyCount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  targetValue?: number;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;
}
