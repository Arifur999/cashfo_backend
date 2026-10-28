import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsNotEmpty, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { normalizeEmail, trim, whenSent } from '../../common/dto.js';
import { AdminRole } from '../../common/roles.js';
import { stripSpaces } from '../../sign-in/two-step-sign-in.dto.js';

// POST /admin/admins/invites
export class CreateAdminInviteDto {
  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsEnum(AdminRole)
  role: AdminRole;
}

// The token from the invite link (?token=...).
export class InviteTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  token: string;
}

// POST /admin/auth/invites/accept
export class AcceptAdminInviteDto extends InviteTokenDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  // better-auth refuses passwords over 128 characters, so a longer one
  // could be saved here and then never sign in.
  @MaxLength(128)
  @MinLength(8)
  @Matches(/(?=.*[A-Za-z])(?=.*\d)/, { message: 'Password must contain at least one letter and one number' })
  password: string;

  // The first code from the authenticator app the page showed the key for.
  @Transform(stripSpaces)
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be the 6-digit code from your authenticator app' })
  code: string;
}

// POST /admin/auth/reset-password
export class AdminResetPasswordDto extends InviteTokenDto {
  @MaxLength(128)
  @MinLength(8)
  @Matches(/(?=.*[A-Za-z])(?=.*\d)/, { message: 'Password must contain at least one letter and one number' })
  password: string;
}
