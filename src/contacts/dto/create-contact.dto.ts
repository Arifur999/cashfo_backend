import { ContactType } from '@prisma/client';
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
