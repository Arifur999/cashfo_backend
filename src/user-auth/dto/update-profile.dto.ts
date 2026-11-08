import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { trim, whenSent } from '../../common/dto.js';
import { DISTRICTS } from '../../common/districts.js';

// An empty string clears an optional text (null is not sent by the page).
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  // Cleared by sending an empty string -- IsOptional lets the field be
  // omitted entirely, but an empty string still passes IsString, so
  // "remove my phone number" and "don't touch it" are both expressible.
  @IsOptional()
  @IsString()
  phone?: string;

  // One line ("House 12, Road 5, Dhanmondi, Dhaka"); an empty string clears it.
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  address?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  occupation?: string;

  // YYYY-MM-DD; the person must be 13 or older (checked in the service).
  @IsOptional()
  @ValidateIf((_, value) => value !== '')
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateOfBirth?: string;

  @IsOptional()
  @IsIn(['', 'MALE', 'FEMALE', 'UNSAID'])
  gender?: '' | 'MALE' | 'FEMALE' | 'UNSAID';

  @IsOptional()
  @IsIn(['', ...DISTRICTS])
  district?: string;

  // A second Bangladesh mobile number, or "" to clear it.
  @IsOptional()
  @IsString()
  phone2?: string;

  @ValidateIf(whenSent)
  @IsBoolean()
  phone2WhatsApp?: boolean;
}
