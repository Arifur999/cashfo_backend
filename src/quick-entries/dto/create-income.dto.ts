import { IsDateString, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import { IsMoney } from '../../common/dto.js';

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

  // A loan's profit or interest: the bank or person it was received from. It
  // shows on their loan statement without moving the loan balance.
  @IsOptional()
  @IsUUID()
  contactId?: string;
}
