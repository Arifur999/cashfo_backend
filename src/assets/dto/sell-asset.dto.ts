import { IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { IsMoney } from '../../common/dto.js';

export class SellAssetDto {
  @IsMoney()
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
