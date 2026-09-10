import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class CreateIncomeDto {
  // The money account (cash/bank/mfs) the income landed in.
  @IsString()
  @IsNotEmpty()
  toAccountId: string;

  // Optional -- falls back to the workspace's default income account. See
  // QuickEntriesService.getDefaultIncomeAccountId() for the lookup
  // convention.
  @IsOptional()
  @IsString()
  incomeAccountId?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsString()
  description?: string;

  // Category table doesn't exist until a later prompt -- stored as a plain
  // string on TransactionEntry.categoryId for now (see Prompt 5's schema).
  @IsOptional()
  @IsString()
  categoryId?: string;
}
