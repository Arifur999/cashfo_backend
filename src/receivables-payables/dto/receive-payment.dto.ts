import { IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { IsMoney } from '../../common/dto.js';

export class ReceivePaymentDto {
  @IsString()
  @IsNotEmpty()
  contactId: string;

  @IsMoney()
  amount: number;

  @IsDateString()
  date: string;

  // The cash/bank/mfs account the payment landed in.
  @IsString()
  @IsNotEmpty()
  moneyAccountId: string;

  @IsOptional()
  @IsString()
  description?: string;

  // If set, applies directly against this specific outstanding SALE
  // transaction (validated to not exceed its remaining balance). If unset,
  // applied as a general payment, allocated FIFO across the contact's
  // oldest outstanding SALE transactions at read time.
  @IsOptional()
  @IsString()
  appliedToTransactionId?: string;
}
