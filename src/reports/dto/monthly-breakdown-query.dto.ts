import { IsIn, IsISO8601, IsOptional, IsString, Length } from 'class-validator';
import { TransactionType } from '@prisma/client';

// The Reports table: one column per calendar month between dateFrom and
// dateTo (both required, at most 24 months), optionally only the entries
// that touched one wallet.
export class MonthlyBreakdownQueryDto {
  @IsIn(['INCOME', 'EXPENSE'])
  type: Extract<TransactionType, 'INCOME' | 'EXPENSE'>;

  @IsISO8601()
  dateFrom: string;

  @IsISO8601()
  dateTo: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  accountId?: string;
}
