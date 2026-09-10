import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { LanguagePreference } from '@prisma/client';

// 01XXXXXXXXX or +8801XXXXXXXXX, operator digit 3-9 per BD numbering plan.
const BD_PHONE_REGEX = /^(?:\+8801[3-9]\d{8}|01[3-9]\d{8})$/;

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
  @Matches(BD_PHONE_REGEX, { message: 'Phone must be a valid Bangladeshi number (e.g. 01XXXXXXXXX)' })
  phone?: string;

  @IsOptional()
  @IsEnum(LanguagePreference)
  preferredLanguage?: LanguagePreference;
}
