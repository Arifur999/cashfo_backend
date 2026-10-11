import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { AdminRole } from '../../common/roles.js';

export class UpdateAdminDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsEnum(AdminRole)
  role?: AdminRole;
}
