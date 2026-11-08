import { GroupSplit } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { BUDGET_CATEGORY_ICONS, GROUP_CATEGORY_COLORS } from '../../budgets/budget-category-visuals.js';

export class GroupCategorySetupItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name: string;

  @IsOptional()
  @IsIn(BUDGET_CATEGORY_ICONS)
  icon?: string;

  @IsOptional()
  @IsIn(GROUP_CATEGORY_COLORS)
  color?: string;

  @IsOptional()
  @IsEnum(GroupSplit)
  defaultSplit?: GroupSplit;
}

// New group, step 3: the categories the family spends on, set once in
// place of the built-in defaults.
export class GroupCategorySetupDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => GroupCategorySetupItemDto)
  categories: GroupCategorySetupItemDto[];
}
