import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { AccountType } from '@prisma/client';

export class CreateAccountDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  nameBn?: string;

  @IsEnum(AccountType)
  accountType: AccountType;

  @IsOptional()
  @IsString()
  accountSubtype?: string;

  @IsOptional()
  @IsString()
  parentId?: string;
}
