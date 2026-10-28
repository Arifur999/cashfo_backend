import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { trim, whenSent } from '../../common/dto.js';

// The ways a customer can choose to pay in the app.
export const CHECKOUT_GATEWAYS = ['BKASH', 'NAGAD', 'CARD'] as const;
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
