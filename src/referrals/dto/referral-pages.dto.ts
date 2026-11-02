import { CommissionStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { trim, whenSent } from '../../common/dto.js';
import { FRIEND_FILTERS, type FriendFilter } from '../referral-friends.js';

// The tag at the end of an invite link (&src=facebook).
export const LINK_TAG = /^[a-z0-9]{2,20}$/;

class PageQuery {
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

export class FriendsQueryDto extends PageQuery {
  @ValidateIf(whenSent)
  @IsIn(FRIEND_FILTERS)
  standing?: FriendFilter;
}

export class EarningsQueryDto extends PageQuery {
  @ValidateIf(whenSent)
  @IsIn(Object.values(CommissionStatus))
  status?: CommissionStatus;

  // "2026-10": the month of the friend's payment (Dhaka calendar).
  @ValidateIf(whenSent)
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must look like 2026-10' })
  month?: string;
}

// Referrals > Profile & payouts.
export class ReferralProfileDto {
  // The name invited friends see; null goes back to the first name.
  @ValidateIf((dto: ReferralProfileDto) => dto.referralName !== undefined && dto.referralName !== null)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  referralName?: string | null;

  @ValidateIf(whenSent)
  @IsBoolean()
  emailEarned?: boolean;

  @ValidateIf(whenSent)
  @IsBoolean()
  emailPayouts?: boolean;
}

// An open of an invite link, from the sign-up page.
export class InviteClickDto {
  @ValidateIf(whenSent)
  @Matches(LINK_TAG)
  src?: string;
}
