import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class CreateExpenseDto {
  // The money account (cash/bank/mfs) the expense was paid from.
  @IsString()
  @IsNotEmpty()
  fromAccountId: string;

  @IsString()
  @IsNotEmpty()
  expenseAccountId: string;

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
