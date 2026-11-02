import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsNotEmpty, IsOptional, IsString, Matches, ValidateIf } from 'class-validator';
import { AccountType } from '@prisma/client';
import { MONEY_STRING_MESSAGE, MONEY_STRING_REGEX, trim, whenSent } from '../../common/dto.js';
import { ACCOUNT_COLORS } from '../account-colors.js';

export class CreateAccountDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  nameBn?: string;

  @IsOptional()
  @IsString()
  accountNumber?: string;

  // A money account's card colour, one of ACCOUNT_COLORS.
  @ValidateIf(whenSent)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsIn(ACCOUNT_COLORS, { message: 'Pick one of the card colours' })
  color?: string;

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
