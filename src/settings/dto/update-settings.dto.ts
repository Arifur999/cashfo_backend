import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { trim } from '../../common/dto.js';

// A wallet number as digits ("01309-000555" is fine); empty turns it off.
const digitsOnly = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.replace(/[\s-]/g, '') : value);

export class BankAccountDetailsDto {
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  bankName: string;

  @Transform(trim)
  @IsString()
  @MaxLength(80)
  branch: string;

  @Transform(trim)
  @IsString()
  @MaxLength(80)
  accountName: string;

  @Transform(trim)
  @IsString()
  @Matches(/^[0-9 -]{0,30}$/, { message: 'The account number has only digits' })
  accountNumber: string;

  @Transform(digitsOnly)
  @IsString()
  @Matches(/^(\d{9})?$/, { message: 'The routing number has 9 digits' })
  routingNumber: string;
}

// Checkout's "Send money yourself": where the money goes.
export class PaymentAccountsDto {
  @Transform(digitsOnly)
  @IsString()
  @Matches(/^(01[3-9]\d{8})?$/, { message: 'The bKash number has 11 digits and starts with 01' })
  bkash: string;

  @Transform(digitsOnly)
  @IsString()
  @Matches(/^(01[3-9]\d{8})?$/, { message: 'The Nagad number has 11 digits and starts with 01' })
  nagad: string;

  @Transform(digitsOnly)
  @IsString()
  @Matches(/^(01[3-9]\d{8}\d?)?$/, { message: 'The Rocket number has 11 or 12 digits and starts with 01' })
  rocket: string;

  @ValidateNested()
  @Type(() => BankAccountDetailsDto)
  bank: BankAccountDetailsDto;
}

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

  // The maintenance notice in Bangla. Blank falls back to the default text.
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  maintenanceMessageBn?: string;

  // Off refuses new customer accounts (POST /api/auth/register and a first
  // Google sign-in).
  @IsOptional()
  @IsBoolean()
  signupsOpen?: boolean;

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

  // The numbers and the bank account the checkout shows, all sent together.
  @IsOptional()
  @ValidateNested()
  @Type(() => PaymentAccountsDto)
  billingPaymentAccounts?: PaymentAccountsDto;

  // Security > Admin team > "Require it for everyone" (two-step sign-in).
  @IsOptional()
  @IsBoolean()
  adminTwoStepRequired?: boolean;
}
