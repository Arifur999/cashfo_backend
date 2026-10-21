import { ValidateIf } from 'class-validator';
import { IsMoney } from '../../common/dto.js';

export class UpdateBudgetTargetDto {
  // An amount sets the overall monthly budget; null clears it, so the Budget
  // page has no total. The field must still be sent: left out, it fails
  // IsMoney as it always has.
  @ValidateIf((_, value) => value !== null)
  @IsMoney()
  monthlyBudgetTarget: number | null;
}
