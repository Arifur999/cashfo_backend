import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { normalizeEmail } from '../common/dto.js';

// The one sign-in form's fields. `email` keeps its name (the frontends and
// the login throttle read it) but takes any of the ways an account signs in:
// an email, a group member's username, or the mobile number of a group
// member's login (Group Expense › member portal). SignInService works out
// which account it names.
export class SignInDto {
  @Transform(normalizeEmail)
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  email: string;

  // No strength rules here -- this validates a login attempt against an
  // existing password hash, not a new password.
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password: string;
}
