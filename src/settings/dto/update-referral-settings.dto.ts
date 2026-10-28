import { ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, Max, Min, ValidateIf } from 'class-validator';
import type { PayoutMethodType } from '@prisma/client';
import { whenSent } from '../../common/dto.js';
import { PAYOUT_METHOD_TYPES, WHO_CAN_EARN, type WhoCanEarn } from '../referral-settings.js';

// Admin > Referrals & Payouts > Settings. Every field is optional; money is
// whole taka and percentages whole numbers.
export class UpdateReferralSettingsDto {
  @ValidateIf(whenSent)
  @IsBoolean()
  programLive?: boolean;

  @ValidateIf(whenSent)
  @IsIn(WHO_CAN_EARN)
  whoCanEarn?: WhoCanEarn;

  @ValidateIf(whenSent)
  @IsInt()
  @Min(0)
  @Max(100)
  commissionPct?: number;

  @ValidateIf(whenSent)
  @IsInt()
  @Min(0)
  @Max(100)
  friendDiscountPct?: number;

  @ValidateIf(whenSent)
  @IsInt()
  @Min(0)
  @Max(365)
  holdDays?: number;

  @ValidateIf(whenSent)
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  minWithdrawal?: number;

  @ValidateIf(whenSent)
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  withdrawalFee?: number;

  @ValidateIf(whenSent)
  @IsInt()
  @Min(1)
  @Max(60)
  payWithinDays?: number;

  @ValidateIf(whenSent)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(PAYOUT_METHOD_TYPES, { each: true })
  payoutMethods?: PayoutMethodType[];

  @ValidateIf(whenSent)
  @IsBoolean()
  blockSelf?: boolean;

  @ValidateIf(whenSent)
  @IsBoolean()
  cancelOnRefund?: boolean;

  @ValidateIf(whenSent)
  @IsBoolean()
  flagSameNumber?: boolean;

  // null = no limit.
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  maxPerMonth?: number | null;
}
