import { IsInt, IsNumberString, IsOptional, Max, Min } from 'class-validator';

export class UpdateGroupMonthBudgetDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @IsOptional()
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;

  @IsOptional()
  @IsNumberString()
  budgetAmount?: string;
}
