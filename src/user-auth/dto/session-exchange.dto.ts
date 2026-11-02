import { IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { whenSent } from '../../common/dto.js';

// The body of a Google sign-in's session exchange. A first Google sign-in
// is also the sign-up, so it may carry the referral code from the invite
// link, like the password sign-up does (an unknown code is ignored).
export class SessionExchangeDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  referralCode?: string;

  // The invite link's tag (&src=facebook): which of the referrer's links
  // the sign-up came through. An unknown tag is ignored.
  @ValidateIf(whenSent)
  @Matches(/^[a-z0-9]{2,20}$/)
  referralSource?: string;
}
