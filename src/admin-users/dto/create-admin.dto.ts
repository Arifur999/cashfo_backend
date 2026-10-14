import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { normalizeEmail } from '../../common/dto.js';
import { AdminRole } from '../../common/roles.js';

export class CreateAdminDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @Transform(normalizeEmail)
  @IsEmail()
  email: string;

  @IsEnum(AdminRole)
  role: AdminRole;

  // If omitted, a temporary password is generated and returned once.
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  temporaryPassword?: string;
}
