import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, Matches, ValidateIf } from 'class-validator';
import { ACCOUNT_COLORS } from '../account-colors.js';
import { MONEY_STRING_MESSAGE, MONEY_STRING_REGEX, trim, whenSent } from '../../common/dto.js';

// accountType is deliberately NOT editable here -- see
// AccountsService.update()'s comment for why (changing an account's type
// out from under existing children is exactly the inconsistent state Part C
// asks to prevent; simplest fix is to just not allow it at all).
export class UpdateAccountDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  nameBn?: string;

  @IsOptional()
  @IsString()
  accountNumber?: string;

  // A money account's card colour, one of ACCOUNT_COLORS; null goes back to its type's own.
  @ValidateIf((dto: UpdateAccountDto) => dto.color !== undefined && dto.color !== null)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsIn(ACCOUNT_COLORS, { message: 'Pick one of the card colours' })
  color?: string | null;

  // A money account's opening balance, entered wrong and put right (Balance >
  // Edit account). The current balance moves by the same amount.
  @ValidateIf(whenSent)
  @Matches(MONEY_STRING_REGEX, { message: `openingBalance ${MONEY_STRING_MESSAGE}` })
  openingBalance?: string;

  @IsOptional()
  @IsString()
  accountSubtype?: string;

  @IsOptional()
  @IsString()
  parentId?: string;
}
