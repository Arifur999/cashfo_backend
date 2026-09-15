import { IsNumber, IsPositive } from 'class-validator';

export class UpdateBudgetTargetDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  monthlyBudgetTarget: number;
}
