import { IsNotEmpty, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { whenSent } from '../../common/dto.js';

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  token: string;

  // better-auth refuses passwords over 128 characters, so a longer one
  // could be saved here and then never sign in.
  @MaxLength(128)
  @MinLength(8)
  @Matches(/(?=.*[A-Za-z])(?=.*\d)/, { message: 'Password must contain at least one letter and one number' })
  newPassword: string;

  // Only when the owner turned on "Ask for a code before a password reset":
  // the challenge from POST reset-password/code and the code it emailed.
  @ValidateIf(whenSent)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  challengeId?: string;

  @ValidateIf(whenSent)
  @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code' })
  code?: string;
}
