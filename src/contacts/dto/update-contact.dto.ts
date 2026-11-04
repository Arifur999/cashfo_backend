import { ContactCategory, ContactType } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { MONEY_STRING_MESSAGE, MONEY_STRING_REGEX } from '../../common/dto.js';

// The opening balance can be corrected (the Loans board's Edit contact): it
// is a field on the contact, not a posting, so the entries stay as they are
// and the current balance moves by the same amount. No status here -- that
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

  @IsOptional()
  @Matches(MONEY_STRING_REGEX, { message: `openingBalance ${MONEY_STRING_MESSAGE}` })
  openingBalance?: string;
}
