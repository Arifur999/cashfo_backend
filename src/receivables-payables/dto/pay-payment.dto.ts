import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class PayPaymentDto {
  @IsString()
  @IsNotEmpty()
  contactId: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  @IsDateString()
  date: string;

  // The cash/bank/mfs account the payment came out of.
  @IsString()
  @IsNotEmpty()
  moneyAccountId: string;

  @IsOptional()
  @IsString()
  description?: string;

  // If set, applies directly against this specific outstanding PURCHASE
  // transaction (validated to not exceed its remaining balance). If unset,
  // applied as a general payment, allocated FIFO across the contact's
  // oldest outstanding PURCHASE transactions at read time.
  @IsOptional()
  @IsString()
  appliedToTransactionId?: string;
}
