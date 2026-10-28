import { GroupSplit } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsEnum, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, ValidateIf } from 'class-validator';
import { BUDGET_CATEGORY_COLORS, BUDGET_CATEGORY_ICONS } from '../../budgets/budget-category-visuals.js';
import { whenSent } from '../../common/dto.js';

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

  // "Only selected": the members a new expense in it is shared by, equally.
  // [] = everyone in the group that day.
  @ValidateIf(whenSent)
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  defaultMemberIds?: string[];
}
