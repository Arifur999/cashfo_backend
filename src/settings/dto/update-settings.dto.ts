import { IsBoolean, IsEmail, IsInt, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, Max, MaxLength, Min } from 'class-validator';

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

  @IsOptional()
  @IsNumber()
  @IsPositive()
  referralRewardAmount?: number;

  // The manual checkout's instructions ({amount}, {reference}, {method}).
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  billingManualInstructionsEn?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  billingManualInstructionsBn?: string;

  // Days a plan stays after its period ends unpaid.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30)
  billingGraceDays?: number;

  // Hours an unpaid checkout stays open.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  billingCheckoutHours?: number;
}
