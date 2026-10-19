import { GroupSplit } from '@prisma/client';
import { IsEnum, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { BUDGET_CATEGORY_COLORS, BUDGET_CATEGORY_ICONS } from '../../budgets/budget-category-visuals.js';

export class CreateGroupExpenseCategoryDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsIn(BUDGET_CATEGORY_ICONS)
  icon?: string | null;

  @IsIn(BUDGET_CATEGORY_COLORS)
  color: string;

  // How a new expense in it is shared, to start with.
  @IsOptional()
  @IsEnum(GroupSplit)
  defaultSplit?: GroupSplit;
}
