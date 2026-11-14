import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { BUDGET_CATEGORY_COLORS, BUDGET_CATEGORY_ICONS } from '../../budgets/budget-category-visuals.js';
import { trim } from '../../common/dto.js';

// The budget colours plus gray: the default Other category's colour, kept
// when it is edited or brought back by Undo (the swatches don't offer it).
export const ASSET_CATEGORY_COLORS = [...BUDGET_CATEGORY_COLORS, 'gray'] as const;

export class CreateAssetCategoryDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  name: string;

  @IsOptional()
  @IsIn(BUDGET_CATEGORY_ICONS)
  icon?: string | null;

  @IsIn(ASSET_CATEGORY_COLORS)
  color: string;
}
