import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { trim } from '../../common/dto.js';
import { LINK_TAG } from './referral-pages.dto.js';

export class UpdateReferralLinkDto {
  // Where it is shared: "Facebook page", "Office friends".
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  label: string;
}

export class CreateReferralLinkDto extends UpdateReferralLinkDto {
  // Small letters and numbers, at the end of the link (&src=facebook).
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @Matches(LINK_TAG, { message: 'Use 2 to 20 small letters and numbers' })
  tag: string;
}
