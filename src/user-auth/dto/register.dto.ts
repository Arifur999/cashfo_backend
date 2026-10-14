import { LanguagePreference } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { normalizeEmail } from '../../common/dto.js';

// Permissive international phone check -- optional leading "+", digits,
// spaces, and hyphens, 6-20 characters total. Not restricted to Bangladeshi
// numbers so a signup from any country can use their own local format.
const PHONE_REGEX = /^\+?[0-9\s-]{6,20}$/;

// The name goes into the welcome email sent to the address given -- which
// nobody has verified yet -- so it can't carry a link or run long.
const NO_LINK_REGEX = /^(?!.*(?:https?:\/\/|www\.|:\/\/)).*$/is;

export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Matches(NO_LINK_REGEX, { message: 'Name cannot contain a web address' })
  name: string;

  @Transform(normalizeEmail)
  @IsEmail()
  email: string;

  // better-auth refuses passwords over 128 characters.
  @MaxLength(128)
  @MinLength(8)
  @Matches(/(?=.*[A-Za-z])(?=.*\d)/, { message: 'Password must contain at least one letter and one number' })
  password: string;

  @IsOptional()
  @Matches(PHONE_REGEX, { message: 'Enter a valid phone number' })
  phone?: string;

  @IsOptional()
  @IsEnum(LanguagePreference)
  preferredLanguage?: LanguagePreference;

  // "Referral Program" -- another user's shareable referralCode, carried
  // through a signup link. An unknown/stale code is silently ignored at
  // registration time (see UserAuthService.register()) rather than
  // rejected -- a bad referral link must never block a signup.
  @IsOptional()
  @IsString()
  referralCode?: string;
}
