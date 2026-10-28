import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// The reset link's token, for sending (or resending) the code that goes
// with it.
export class ResetCodeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  token: string;
}
