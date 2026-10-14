import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { normalizeEmail } from '../../common/dto.js';

export class LoginDto {
  @Transform(normalizeEmail)
  @IsEmail()
  email: string;

  // No strength rules here -- this validates a login attempt against an
  // existing password hash, not a new password.
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password: string;
}
