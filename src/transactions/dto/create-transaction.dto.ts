import { Type } from 'class-transformer';
import { ArrayMinSize, IsDateString, IsEnum, IsOptional, IsString, ValidateNested } from 'class-validator';
import { TransactionType } from '@prisma/client';
import { CreateTransactionEntryDto } from './create-transaction-entry.dto.js';

export class CreateTransactionDto {
  @IsEnum(TransactionType)
  transactionType: TransactionType;

  @IsDateString()
  transactionDate: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  referenceNo?: string;

  @IsOptional()
  @IsString()
  contactId?: string;

  // Prompt 9: due date for a SALE/PURCHASE (drives aging/overdue), or the
  // specific outstanding transaction a PAYMENT is applied to -- see the
  // schema comment on Transaction.dueDate/appliedToTransactionId.
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  appliedToTransactionId?: string;

  // At least 2 -- a single-entry "transaction" isn't double-entry
  // bookkeeping. The service layer re-checks this defensively too (see
  // TransactionsService.validateEntries()), not just trusting this decorator.
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => CreateTransactionEntryDto)
  entries: CreateTransactionEntryDto[];

  // Client-generated (e.g. a UUID). Reusing this key returns the existing
  // transaction instead of creating a duplicate -- see
  // TransactionsService.createTransaction().
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
