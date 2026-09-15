import { BudgetCategoryType } from '@prisma/client';
import { IsEnum, IsIn, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';
import { BUDGET_CATEGORY_COLORS, BUDGET_CATEGORY_ICONS } from '../budget-category-visuals.js';

export class CreateBudgetCategoryDto {
  // EXPENSE (Budget Planning) vs INCOME (Income Planning) -- defaults to
  // EXPENSE so the original Budget Planning callers (which never send this)
  // keep working exactly as before.
  @IsOptional()
  @IsEnum(BudgetCategoryType)
  type?: BudgetCategoryType;

  @IsString()
  @IsNotEmpty()
  name: string;

  // Optional/nullable -- a category can be saved with no icon chosen at
  // all (just its color), see BudgetCategory.icon's schema comment.
  @IsOptional()
  @IsIn(BUDGET_CATEGORY_ICONS)
  icon?: string | null;

  @IsIn(BUDGET_CATEGORY_COLORS)
  color: string;

  // Required for EXPENSE, not accepted for INCOME (validated in
  // BudgetsService.createCategory, which knows the resolved type -- see
  // BudgetCategory.monthlyLimit's schema comment for why).
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  monthlyLimit?: number;
}
