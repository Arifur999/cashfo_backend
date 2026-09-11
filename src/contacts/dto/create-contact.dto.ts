import { ContactCategory, ContactType } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsNumberString, IsOptional, IsString } from 'class-validator';

// "At least one of phone/email" is a cross-field business rule, checked in
// ContactsService rather than here -- same reasoning as AccountsService's
// requireCompatibleParent(), the service is the real validation boundary.
export class CreateContactDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(ContactType)
  type: ContactType;

  // BUSINESS (customer/supplier trade relationships, Dena-Pawna) vs LOAN
  // (bank/person lending relationships, Loan Management). Defaults to
  // BUSINESS when omitted -- existing callers (Prompt 8's ContactFormModal)
  // never send this and should keep working exactly as before.
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
  @IsNumberString()
  openingBalance?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
