import { CommissionStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsNotEmpty, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { trim, whenSent } from '../../common/dto.js';
import { FRIEND_FILTERS, type FriendFilter } from '../referral-friends.js';

// The tag at the end of an invite link (&src=facebook).
export const LINK_TAG = /^[a-z0-9]{2,20}$/;

// A calendar day; IsISO8601 then refuses one that doesn't exist (02-30).
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MESSAGE = 'must be a date in YYYY-MM-DD form';

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

  // Or a run of days (the Choose period picker's month, year or own days):
  // 2026-08-01 to 2026-10-28 on the Dhaka calendar, both included. Either
  // end may be left open.
  @ValidateIf(whenSent)
  @Matches(DAY, { message: `dateFrom ${DAY_MESSAGE}` })
  @IsISO8601({ strict: true })
  dateFrom?: string;

  @ValidateIf(whenSent)
  @Matches(DAY, { message: `dateTo ${DAY_MESSAGE}` })
  @IsISO8601({ strict: true })
  dateTo?: string;
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

  // "Monthly statement": an email on the 1st with last month's earnings.
  @ValidateIf(whenSent)
  @IsBoolean()
  monthlyStatement?: boolean;
}

// An open of an invite link, from the sign-up page.
export class InviteClickDto {
  @ValidateIf(whenSent)
  @Matches(LINK_TAG)
  src?: string;
}
