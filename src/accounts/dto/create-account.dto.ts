import { IsEnum, IsNotEmpty, IsNumberString, IsOptional, IsString } from 'class-validator';
import { AccountType } from '@prisma/client';

export class CreateAccountDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  nameBn?: string;

  @IsOptional()
  @IsString()
  accountNumber?: string;

  @IsEnum(AccountType)
  accountType: AccountType;

  @IsOptional()
  @IsString()
  accountSubtype?: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  // One-time starting balance, same "set at creation only" convention as
  // Contact.openingBalance (Prompt 8) -- see UpdateAccountDto for why it's
  // not editable afterward.
  @IsOptional()
  @IsNumberString()
  openingBalance?: string;
}
