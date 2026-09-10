import { IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  platformName?: string;

  @IsOptional()
  @IsEmail()
  supportEmail?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  defaultCurrency?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  defaultTimezone?: string;

  @IsOptional()
  @IsBoolean()
  maintenanceMode?: boolean;

  @IsOptional()
  @IsString()
  maintenanceMessage?: string;
}
