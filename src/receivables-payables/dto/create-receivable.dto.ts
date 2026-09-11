import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class CreateReceivableDto {
  @IsString()
  @IsNotEmpty()
  contactId: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  description?: string;

  // Optional -- falls back to the workspace's default income account, same
  // lowest-displayOrder lookup convention as Prompt 6's QuickEntriesService.
  // Ignored for a LOAN-category contact (see
  // ReceivablesPayablesService.recordSale()'s comment) -- a loan given out
  // isn't revenue, so it never touches an Income account at all.
  @IsOptional()
  @IsString()
  incomeAccountId?: string;

  // Required when contact.category is LOAN -- giving a loan is real cash
  // leaving a money account (Dr Accounts Receivable / Cr this account),
  // unlike a BUSINESS-category credit sale which recognizes revenue with
  // no immediate cash movement at all. Ignored for BUSINESS contacts.
  @IsOptional()
  @IsString()
  moneyAccountId?: string;
}
