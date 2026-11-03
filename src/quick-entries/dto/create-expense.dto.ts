import { IsDateString, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
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

  // A bank or service charge paid with this entry, out of the same wallet.
  // Posted as an expense of its own, tied to this entry (chargeForId): it
  // is voided and corrected with it.
  @IsOptional()
  @IsMoney()
  charge?: number;

  @IsDateString()
  date: string;

  // The popup's Description box holds 500 characters.
  @IsOptional()
  @IsString()
  @MaxLength(500)
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

  // The popup's Description box holds 500 characters.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  // A loan's profit or interest: the bank or person it was paid to. It
  // shows on their loan statement without moving the loan balance.
  @IsOptional()
  @IsUUID()
  contactId?: string;
}
