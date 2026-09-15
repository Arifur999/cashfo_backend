import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class CreateSavingsTransferDto {
  @IsString()
  @IsNotEmpty()
  fromGoalId: string;

  @IsString()
  @IsNotEmpty()
  toGoalId: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
