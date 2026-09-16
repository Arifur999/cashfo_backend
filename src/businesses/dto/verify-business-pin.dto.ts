import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyBusinessPinDto {
  @IsString()
  @IsNotEmpty()
  pin: string;
}
