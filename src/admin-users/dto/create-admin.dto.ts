import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import { AdminRole } from '@prisma/client';

export class CreateAdminDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEmail()
  email: string;

  @IsEnum(AdminRole)
  role: AdminRole;

  // If omitted, a temporary password is generated and returned once.
  @IsOptional()
  @IsString()
  @MinLength(8)
  temporaryPassword?: string;
}
