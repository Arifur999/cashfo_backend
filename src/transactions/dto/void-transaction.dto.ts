import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class VoidTransactionDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  reason: string;
}
