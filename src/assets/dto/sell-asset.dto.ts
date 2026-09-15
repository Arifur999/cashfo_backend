import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class SellAssetDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  soldPrice: number;

  @IsString()
  @IsNotEmpty()
  soldAccountId: string;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
