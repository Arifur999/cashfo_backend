import { IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';
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

  @IsOptional()
  @IsString()
  note?: string;
}
