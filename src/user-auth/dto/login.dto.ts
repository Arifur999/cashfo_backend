import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  // No strength rules here -- this validates a login attempt against an
  // existing password hash, not a new password.
  @IsString()
  @IsNotEmpty()
  password: string;
}
