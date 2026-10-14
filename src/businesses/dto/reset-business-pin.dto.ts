import { IsNotEmpty, IsString } from 'class-validator';

// "Forgot PIN?": the owner's account password removes the lock.
export class ResetBusinessPinDto {
  @IsString()
  @IsNotEmpty()
  password: string;
}
