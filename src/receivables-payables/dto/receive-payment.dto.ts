import { IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { IsMoney } from '../../common/dto.js';

export class ReceivePaymentDto {
  @IsString()
  @IsNotEmpty()
  contactId: string;

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

  // The cash/bank/mfs account the payment landed in.
  @IsString()
  @IsNotEmpty()
  moneyAccountId: string;

  @IsOptional()
  @IsString()
  description?: string;

  // A receipt, cheque or slip number; shown in the Reference column.
  @IsOptional()
  @IsString()
  referenceNo?: string;

  // If set, applies directly against this specific outstanding SALE
  // transaction (validated to not exceed its remaining balance). If unset,
  // applied as a general payment, allocated FIFO across the contact's
  // oldest outstanding SALE transactions at read time.
  @IsOptional()
  @IsString()
  appliedToTransactionId?: string;
}
