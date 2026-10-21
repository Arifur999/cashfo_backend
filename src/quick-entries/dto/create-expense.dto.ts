import { IsDateString, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import { IsMoney } from '../../common/dto.js';

export class CreateExpenseDto {
  // The money account (cash/bank/mfs) the expense was paid from.
  @IsString()
  @IsNotEmpty()
  fromAccountId: string;

  @IsString()
  @IsNotEmpty()
  expenseAccountId: string;

  @IsMoney()
  amount: number;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsString()
  description?: string;

  // A receipt, cheque or slip number; shown in the Reference column.
  @IsOptional()
  @IsString()
  referenceNo?: string;

  // Category table doesn't exist until a later prompt -- stored as a plain
  // string on TransactionEntry.categoryId for now (see Prompt 5's schema).
  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  note?: string;

  // A loan's profit or interest: the bank or person it was paid to. It
  // shows on their loan statement without moving the loan balance.
  @IsOptional()
  @IsUUID()
  contactId?: string;
}
