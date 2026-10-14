import { IsMoney } from '../../common/dto.js';

export class UpdateBudgetTargetDto {
  @IsMoney()
  monthlyBudgetTarget: number;
}
