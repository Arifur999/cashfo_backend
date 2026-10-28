import { PayoutMethodType, PayoutStatus, ReferralStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsNotEmpty, IsString, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { IsMoney, trim, whenSent } from '../../common/dto.js';

class AdminPageQuery {
  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;

  @ValidateIf(whenSent)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ValidateIf(whenSent)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class ListPayoutsQueryDto extends AdminPageQuery {
  @ValidateIf(whenSent)
  @IsIn(Object.values(PayoutStatus))
  status?: PayoutStatus;

  @ValidateIf(whenSent)
  @IsIn(Object.values(PayoutMethodType))
  method?: PayoutMethodType;
}

export class ListReferralsQueryDto extends AdminPageQuery {
  @ValidateIf(whenSent)
  @IsIn(Object.values(ReferralStatus))
  status?: ReferralStatus;
}

export class ReasonDto {
  @Transform(trim)
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}

export class MarkPayoutPaidDto {
  // The bKash / Nagad / Rocket TrxID or the bank's reference.
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  trxId: string;

  // When it was sent; now when left out. Not in the future.
  @ValidateIf(whenSent)
  @IsISO8601()
  paidAt?: string;

  // What was sent; the amount less the fee when left out.
  @ValidateIf(whenSent)
  @IsMoney()
  paidAmount?: number;

  // Tell the member in the app and by email (default yes).
  @ValidateIf(whenSent)
  @IsBoolean()
  notifyUser?: boolean;

  // Kept in the audit log.
  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  note?: string;
}
