import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class CreateTransferDto {
  @IsString()
  @IsNotEmpty()
  fromAccountId: string;

  @IsString()
  @IsNotEmpty()
  toAccountId: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsString()
  description?: string;
}
