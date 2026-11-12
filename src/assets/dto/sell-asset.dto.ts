import { Transform } from 'class-transformer';
import { IsDateString, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { IsMoney, trim } from '../../common/dto.js';

// A sale, and a sale set right (Purchase & Sell › Edit sale).
export class SellAssetDto {
  @IsMoney()
  soldPrice: number;

  @IsString()
  @IsNotEmpty()
  soldAccountId: string;

  @IsDateString()
  date: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  notes?: string;
}
