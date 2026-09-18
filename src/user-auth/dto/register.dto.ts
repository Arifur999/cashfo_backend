import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { LanguagePreference } from '@prisma/client';

// Permissive international phone check -- optional leading "+", digits,
// spaces, and hyphens, 6-20 characters total. Not restricted to Bangladeshi
// numbers so a signup from any country can use their own local format.
const PHONE_REGEX = /^\+?[0-9\s-]{6,20}$/;

export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEmail()
  email: string;

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
