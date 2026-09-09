import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class SuspendUserDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  reason: string;
}
