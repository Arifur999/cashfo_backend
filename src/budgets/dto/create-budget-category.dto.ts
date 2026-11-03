import { BudgetCategoryType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { BUDGET_CATEGORY_COLORS, BUDGET_CATEGORY_ICONS } from '../budget-category-visuals.js';
import { IsMoney, trim } from '../../common/dto.js';

export class CreateBudgetCategoryDto {
  // EXPENSE (Budget Planning) vs INCOME (Income Planning) -- defaults to
  // EXPENSE so the original Budget Planning callers (which never send this)
  // keep working exactly as before.
  @IsOptional()
  @IsEnum(BudgetCategoryType)
  type?: BudgetCategoryType;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  name: string;

  // Optional/nullable -- a category can be saved with no icon chosen at
  // all (just its color), see BudgetCategory.icon's schema comment.
  @IsOptional()
  @IsIn(BUDGET_CATEGORY_ICONS)
  icon?: string | null;

  // Picked for it when left out (BudgetsService.createCategory).
  @IsOptional()
  @IsIn(BUDGET_CATEGORY_COLORS)
  color?: string;

  // Required for EXPENSE, not accepted for INCOME (validated in
  // BudgetsService.createCategory, which knows the resolved type -- see
  // BudgetCategory.monthlyLimit's schema comment for why).
  @IsOptional()
  @IsMoney()
  monthlyLimit?: number;
}
