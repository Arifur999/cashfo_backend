import { Type } from 'class-transformer';
import { IsInt, Max, Min, ValidateIf } from 'class-validator';
import { IsMoney, whenSent } from '../../common/dto.js';

// Budget Planning > "Set monthly budget": a month's income target and
// expense budget, made or replaced in one go. An edit that picks another
// month moves its plan there: fromMonth and fromYear name the month the
// plan is in now (both or neither).
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

  @ValidateIf(whenSent)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  fromMonth?: number;

  @ValidateIf(whenSent)
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  fromYear?: number;
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
