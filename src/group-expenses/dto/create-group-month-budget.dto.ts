import { IsInt, IsNumberString, Max, Min } from 'class-validator';

export class CreateGroupMonthBudgetDto {
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;

  @IsNumberString()
  budgetAmount: string;
}
