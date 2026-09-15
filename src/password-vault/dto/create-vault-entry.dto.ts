import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { VaultEntryCategory } from '@prisma/client';

export class CreateVaultEntryDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsEnum(VaultEntryCategory)
  category: VaultEntryCategory;

  @IsOptional()
  @IsString()
  websiteUrl?: string;

  @IsOptional()
  @IsString()
  usernameOrEmail?: string;

  @IsString()
  @IsNotEmpty()
  password: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
