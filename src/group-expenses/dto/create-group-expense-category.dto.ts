import { GroupSplit } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Min, ValidateIf } from 'class-validator';
import { BUDGET_CATEGORY_ICONS, GROUP_CATEGORY_COLORS } from '../../budgets/budget-category-visuals.js';
import { IsMoney, whenSent } from '../../common/dto.js';

export class CreateGroupExpenseCategoryDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsIn(BUDGET_CATEGORY_ICONS)
  icon?: string | null;

  @IsIn(GROUP_CATEGORY_COLORS)
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

  // What it may spend in a month (the v16 Budget board); null: no limit.
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsMoney()
  @Min(0.01)
  monthlyLimit?: number | null;

  // Hidden: not offered for new expenses; old records keep it.
  @ValidateIf(whenSent)
  @IsBoolean()
  hidden?: boolean;
}
