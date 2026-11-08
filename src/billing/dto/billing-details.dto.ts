import { Transform } from 'class-transformer';
import { IsEmail, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { normalizeEmail, trim } from '../../common/dto.js';
import { BILLING_NAME_REGEX } from '../billing-details.js';

// Settings › Plans & billing › Billing details. All three are sent each
// time; an empty phone or email falls back to the account's own.
export class BillingDetailsDto {
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'Use at least 2 letters.' })
  @MaxLength(60)
  @Matches(BILLING_NAME_REGEX, { message: 'Use letters only, no numbers or symbols.' })
  name: string;

  // A Bangladesh mobile number in any common form, or "".
  @Transform(trim)
  @IsString()
  @MaxLength(20)
  phone: string;

  @Transform(normalizeEmail)
  @ValidateIf((dto: BillingDetailsDto) => dto.email !== '')
  @IsEmail({}, { message: 'Type an email like name@example.com.' })
  @MaxLength(254)
  email: string;
}
