import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsNotEmpty, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { trim, whenSent } from '../../common/dto.js';
import { CreateBudgetCategoryDto } from './create-budget-category.dto.js';

// The most entries one undo carries back (a delete's reply lists them).
export const RESTORE_ENTRIES_MAX = 20_000;

// POST categories/restore: Undo of a delete. The category is made again as
// it was and, when its transactions were moved, the entries the delete moved
// (its reply's movedEntryIds) go back from the category they went to.
export class RestoreBudgetCategoryDto extends CreateBudgetCategoryDto {
  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  movedTo?: string;

  @ValidateIf(whenSent)
  @IsArray()
  @ArrayMaxSize(RESTORE_ENTRIES_MAX)
  @IsUUID('all', { each: true })
  entryIds?: string[];
}
