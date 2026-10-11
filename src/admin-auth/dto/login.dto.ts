import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { normalizeEmail } from '../../common/dto.js';

export class LoginDto {
  @Transform(normalizeEmail)
  @IsEmail()
  email: string;

  // No minimum length here -- this validates a login attempt against an
  // existing password hash, not a new password. The 8-character minimum
  // rule applies to the "create admin" endpoint coming in Prompt 2.
  @IsString()
  @IsNotEmpty()
  password: string;
}
