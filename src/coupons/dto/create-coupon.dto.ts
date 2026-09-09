import { Transform } from 'class-transformer';
import { ArrayUnique, IsArray, IsDateString, IsEnum, IsInt, IsOptional, IsPositive, IsString, Min } from 'class-validator';
import { DiscountType } from '@prisma/client';

export class CreateCouponDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase().trim() : value))
  @IsString()
  code: string;

  @IsEnum(DiscountType)
  discountType: DiscountType;

  @IsPositive()
  discountValue: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxRedemptions?: number;

  @IsDateString()
  validFrom: string;

  @IsDateString()
  validUntil: string;

  // Array of SubscriptionPlan ids; empty/omitted = applies to all plans.
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  applicablePlans?: string[];
}
