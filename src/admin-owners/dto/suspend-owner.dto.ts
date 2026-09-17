import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class SuspendOwnerDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  reason: string;
}
