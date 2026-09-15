import { ContactCategory, ContactType } from '@prisma/client';
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

  // BUSINESS (Dena-Pawna) vs LOAN (Loan Management) -- lets a contact be
  // reclassified after creation. Existing transactions aren't touched, only
  // which dashboard the contact (and its history) appears under.
  @IsOptional()
  @IsEnum(ContactCategory)
  category?: ContactCategory;

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
