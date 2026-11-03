import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { trim, whenSent } from '../../common/dto.js';
import { MANUAL_WALLETS, type ManualWallet } from '../manual-payments.js';

// The ways a customer can choose to pay in the app: sending the money
// themselves (MANUAL_WALLETS), or online (CARD).
export const CHECKOUT_GATEWAYS = [...MANUAL_WALLETS, 'CARD'] as const;
export type CheckoutGateway = (typeof CHECKOUT_GATEWAYS)[number];

export class PlanChoiceDto {
  @IsString()
  @IsNotEmpty()
  planId: string;
}

export class CouponPreviewDto extends PlanChoiceDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  code: string;
}

export class CheckoutDto extends PlanChoiceDto {
  @IsIn(CHECKOUT_GATEWAYS)
  gateway: CheckoutGateway;

  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  couponCode?: string;

  // Sent together once the money is sent: the number (or, for a bank, the
  // account name) it came from and the TrxID. The checkout then waits for
  // an admin instead of lapsing.
  @ValidateIf(whenSent)
  @IsString()
  @MaxLength(80)
  payerAccount?: string;

  @ValidateIf(whenSent)
  @IsString()
  @MaxLength(60)
  reference?: string;
}

// "Fix the details" on a payment being checked, or sending them later.
export class PaymentDetailsDto {
  @IsIn(MANUAL_WALLETS)
  gateway: ManualWallet;

  @IsString()
  @MaxLength(80)
  payerAccount: string;

  @IsString()
  @MaxLength(60)
  reference: string;
}

export class BillingPaymentsQueryDto {
  @ValidateIf(whenSent)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ValidateIf(whenSent)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
