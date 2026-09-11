import { ContactType } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

// No openingBalance here -- it's a one-time starting point set at creation,
// not something meant to be silently edited later (that would make
// currentBalance's history untrustworthy). No status here either -- that
// goes through the dedicated archive endpoint, which has its own
// "block if outstanding balance" business rule.
export class UpdateContactDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsEnum(ContactType)
  type?: ContactType;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  photoUrl?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
