import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

// accountType is deliberately NOT editable here -- see
// AccountsService.update()'s comment for why (changing an account's type
// out from under existing children is exactly the inconsistent state Part C
// asks to prevent; simplest fix is to just not allow it at all).
export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  nameBn?: string;

  @IsOptional()
  @IsString()
  accountSubtype?: string;

  @IsOptional()
  @IsString()
  parentId?: string;
}
