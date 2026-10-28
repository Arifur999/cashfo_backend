import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { IsMoney } from '../../common/dto.js';

// Budget Planning > "Set monthly budget": a month's income target and
// expense budget, made or replaced in one go.
export class SaveMonthlyPlanDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;

  @IsMoney()
  incomeTarget: number;

  @IsMoney()
  expenseBudget: number;
}

export class MonthlyPlanQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;
}
