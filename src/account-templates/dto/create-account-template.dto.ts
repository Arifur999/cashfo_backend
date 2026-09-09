import { IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { AccountType, WorkspaceType } from '@prisma/client';

export class CreateAccountTemplateDto {
  @IsString()
  name: string;

  @IsString()
  nameBn: string;

  @IsEnum(AccountType)
  accountType: AccountType;

  @IsOptional()
  @IsString()
  accountSubtype?: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsArray()
  @IsEnum(WorkspaceType, { each: true })
  appliesTo: WorkspaceType[];

  @IsOptional()
  @IsInt()
  displayOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
