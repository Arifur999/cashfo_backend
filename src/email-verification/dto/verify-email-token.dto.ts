import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// The token from the verification link (?token=...), checked or used.
export class VerifyEmailTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  token: string;
}
