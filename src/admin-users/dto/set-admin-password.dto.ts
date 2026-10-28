import { Matches, MaxLength, MinLength } from 'class-validator';

// POST /admin/admins/:id/set-password: the same rules as every new password.
export class SetAdminPasswordDto {
  // better-auth refuses passwords over 128 characters, so a longer one
  // could be saved here and then never sign in.
  @MaxLength(128)
  @MinLength(8)
  @Matches(/(?=.*[A-Za-z])(?=.*\d)/, { message: 'Password must contain at least one letter and one number' })
  password: string;
}
