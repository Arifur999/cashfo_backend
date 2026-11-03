import { BudgetCategoryType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { BUDGET_CATEGORY_COLORS, BUDGET_CATEGORY_ICONS } from '../budget-category-visuals.js';
import { IsMoney, trim, whenSent } from '../../common/dto.js';

export class UpdateBudgetCategoryDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  name?: string;

  // Changes only while no transaction uses the category.
  @ValidateIf(whenSent)
  @IsEnum(BudgetCategoryType)
  type?: BudgetCategoryType;

  // Optional/nullable -- see CreateBudgetCategoryDto.icon.
  @IsOptional()
  @IsIn(BUDGET_CATEGORY_ICONS)
  icon?: string | null;

  @IsOptional()
  @IsIn(BUDGET_CATEGORY_COLORS)
  color?: string;

  @IsOptional()
  @IsMoney()
  monthlyLimit?: number;
}
