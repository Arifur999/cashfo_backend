import { IsBoolean, IsNotEmpty, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { whenSent } from '../../common/dto.js';

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  // better-auth refuses passwords over 128 characters, so a longer one
  // could be saved here and then never sign in.
  @MaxLength(128)
  @MinLength(8)
  @Matches(/(?=.*[A-Za-z])(?=.*\d)/, { message: 'Password must contain at least one letter and one number' })
  newPassword: string;

  // "Sign out of my other devices" (customer ChangePasswordDialog); left
  // out means yes. An admin's change always signs the others out.
  @ValidateIf(whenSent)
  @IsBoolean()
  signOutOthers?: boolean;
}
