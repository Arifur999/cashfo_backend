import { IsUUID, ValidateIf } from 'class-validator';
import { whenSent } from '../../common/dto.js';

// DELETE categories/:id?moveTo=: the category of the same type its
// transactions move to (needed only while some use it).
export class DeleteBudgetCategoryQueryDto {
  @ValidateIf(whenSent)
  @IsUUID()
  moveTo?: string;
}
