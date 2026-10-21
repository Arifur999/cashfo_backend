import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CheckResetTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  token: string;
}
