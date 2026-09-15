import { IsIn, IsISO8601, IsOptional } from 'class-validator';
import { TransactionType } from '@prisma/client';

export class CategoryBreakdownQueryDto {
  @IsIn(['INCOME', 'EXPENSE'])
  type: Extract<TransactionType, 'INCOME' | 'EXPENSE'>;

  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @IsOptional()
  @IsISO8601()
  dateTo?: string;
}
