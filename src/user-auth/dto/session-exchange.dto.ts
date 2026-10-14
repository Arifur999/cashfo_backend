import { IsOptional, IsString, MaxLength } from 'class-validator';

// The body of a Google sign-in's session exchange. A first Google sign-in
// is also the sign-up, so it may carry the referral code from the invite
// link, like the password sign-up does (an unknown code is ignored).
export class SessionExchangeDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  referralCode?: string;
}
