import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  // No minimum length here -- this validates a login attempt against an
  // existing password hash, not a new password. The 8-character minimum
  // rule applies to registration (RegisterDto).
  @IsString()
  @IsNotEmpty()
  password: string;
}
