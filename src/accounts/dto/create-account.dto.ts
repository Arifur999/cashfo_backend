import { IsEnum, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { AccountType } from '@prisma/client';
import { MONEY_STRING_MESSAGE, MONEY_STRING_REGEX } from '../../common/dto.js';

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
  @Matches(MONEY_STRING_REGEX, { message: `openingBalance ${MONEY_STRING_MESSAGE}` })
  openingBalance?: string;
}
