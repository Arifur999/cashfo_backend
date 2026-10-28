import { BankAccountType, PayoutMethodType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsString, MaxLength, ValidateIf } from 'class-validator';
import { trim, whenSent } from '../../common/dto.js';

// null clears an optional field (a branch), so null is let through here
// and the service checks the method as a whole for its type.
const whenGiven = (_: unknown, value: unknown) => value !== undefined && value !== null;

export class CreatePayoutMethodDto {
  @IsIn(Object.values(PayoutMethodType))
  type: PayoutMethodType;

  @Transform(trim)
  @IsString()
  @MaxLength(80)
  accountName: string;

  // BKASH / NAGAD / ROCKET: "01711-482915", "+8801711482915", ...
  @ValidateIf(whenGiven)
  @IsString()
  @MaxLength(20)
  walletNumber?: string | null;

  @ValidateIf(whenGiven)
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  bankName?: string | null;

  @ValidateIf(whenGiven)
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  branch?: string | null;

  @ValidateIf(whenGiven)
  @IsIn(Object.values(BankAccountType))
  bankAccountType?: BankAccountType | null;

  @ValidateIf(whenGiven)
  @IsString()
  @MaxLength(30)
  accountNumber?: string | null;

  @ValidateIf(whenGiven)
  @IsString()
  @MaxLength(15)
  routingNumber?: string | null;

  @ValidateIf(whenSent)
  @IsBoolean()
  isDefault?: boolean;
}

// Any of the fields; the method is checked again as a whole.
export class UpdatePayoutMethodDto {
  @ValidateIf(whenSent)
  @IsIn(Object.values(PayoutMethodType))
  type?: PayoutMethodType;

  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  accountName?: string;

  @ValidateIf(whenGiven)
  @IsString()
  @MaxLength(20)
  walletNumber?: string | null;

  @ValidateIf(whenGiven)
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  bankName?: string | null;

  @ValidateIf(whenGiven)
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  branch?: string | null;

  @ValidateIf(whenGiven)
  @IsIn(Object.values(BankAccountType))
  bankAccountType?: BankAccountType | null;

  @ValidateIf(whenGiven)
  @IsString()
  @MaxLength(30)
  accountNumber?: string | null;

  @ValidateIf(whenGiven)
  @IsString()
  @MaxLength(15)
  routingNumber?: string | null;

  @ValidateIf(whenSent)
  @IsBoolean()
  isDefault?: boolean;
}
