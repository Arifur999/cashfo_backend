import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, Min } from 'class-validator';
import { ContactCategory, TransactionStatus, TransactionType } from '@prisma/client';

export class ListTransactionsQueryDto {
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @IsOptional()
  @IsIn(Object.values(TransactionType))
  transactionType?: TransactionType;

  // Transactions touching this account (i.e. it has at least one entry
  // against it), not "transactions belonging to" -- an account concept.
  @IsOptional()
  @IsString()
  accountId?: string;

  // Prompt 8: transactions linked to a specific Contact -- powers the
  // contact detail page's Activity tab, reused as-is rather than
  // duplicating pagination/filtering logic in ContactsService.
  @IsOptional()
  @IsString()
  contactId?: string;

  // Loan Management: transactions linked to any contact of a given
  // category (LOAN), not just one specific contact -- powers the Loan
  // Management Transactions page.
  @IsOptional()
  @IsIn(Object.values(ContactCategory))
  contactCategory?: ContactCategory;

  @IsOptional()
  @IsIn(Object.values(TransactionStatus))
  status?: TransactionStatus;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
