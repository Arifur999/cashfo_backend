import { IsNotEmpty, IsString, IsUUID, Matches, MaxLength, ValidateIf } from 'class-validator';
import { whenSent } from '../../common/dto.js';

// Settings > Profile > "Verify": the account password (left out for a
// Google-only account, which needs a recent sign-in instead).
export class StartPhoneVerifyDto {
  @ValidateIf(whenSent)
  @IsString()
  @IsNotEmpty()
  currentPassword?: string;
}

export class ConfirmCodeDto {
  @IsUUID()
  challengeId: string;

  @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code' })
  code: string;
}

// "Forgot password" by phone.
export class PhoneResetDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  phone: string;
}

export class PhoneResetConfirmDto extends PhoneResetDto {
  @IsUUID()
  challengeId: string;

  @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code' })
  code: string;
}
