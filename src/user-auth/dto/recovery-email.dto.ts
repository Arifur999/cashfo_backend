import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, IsUUID, Matches, MaxLength, ValidateIf } from 'class-validator';
import { normalizeEmail, whenSent } from '../../common/dto.js';

export class StartRecoveryEmailDto {
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email: string;

  // The account's password; a Google-only account has none to give.
  @ValidateIf(whenSent)
  @IsString()
  @IsNotEmpty()
  password?: string;
}

export class ConfirmRecoveryEmailDto {
  @IsUUID()
  challengeId: string;

  @Matches(/^\d{6}$/)
  code: string;
}
