import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { AdminRole } from '@prisma/client';

export class UpdateAdminDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsEnum(AdminRole)
  role?: AdminRole;
}
