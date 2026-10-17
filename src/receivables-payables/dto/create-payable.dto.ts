import { IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { IsMoney } from '../../common/dto.js';

export class CreatePayableDto {
  @IsString()
  @IsNotEmpty()
  contactId: string;

  @IsMoney()
  amount: number;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  description?: string;

  // The supplier's bill number.
  @IsOptional()
  @IsString()
  referenceNo?: string;

  // Optional -- falls back to the workspace's default expense account (same
  // lowest-displayOrder convention as the income-account default). Ignored
  // for a LOAN-category contact -- taking a loan isn't an expense.
  @IsOptional()
  @IsString()
  expenseAccountId?: string;

  // Required when contact.category is LOAN -- taking a loan is real cash
  // landing in a money account (Dr this account / Cr Accounts Payable),
  // unlike a BUSINESS-category credit purchase which recognizes an expense
  // with no immediate cash movement at all. Ignored for BUSINESS contacts.
  @IsOptional()
  @IsString()
  moneyAccountId?: string;
}
