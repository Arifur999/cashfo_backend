import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';
import { BUDGET_CATEGORY_COLORS, BUDGET_CATEGORY_ICONS } from '../budget-category-visuals.js';

export class UpdateBudgetCategoryDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  // Optional/nullable -- see CreateBudgetCategoryDto.icon.
  @IsOptional()
  @IsIn(BUDGET_CATEGORY_ICONS)
  icon?: string | null;

  @IsOptional()
  @IsIn(BUDGET_CATEGORY_COLORS)
  color?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  monthlyLimit?: number;
}
