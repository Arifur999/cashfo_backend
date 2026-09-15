import { BudgetCategoryType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

// month/year both optional -- default to the current calendar month/year
// when omitted, same "sensible default when the caller doesn't care"
// convention as ListTransactionsQueryDto's page/limit. type defaults to
// EXPENSE (Budget Planning) when omitted so the original callers keep
// working unchanged; Income Planning passes type=INCOME explicitly.
export class BudgetQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;

  @IsOptional()
  @IsEnum(BudgetCategoryType)
  type?: BudgetCategoryType;
}
