import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class BanUserDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  reason: string;
}
