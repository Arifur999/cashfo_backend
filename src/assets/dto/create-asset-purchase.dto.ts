import { IsDateString, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';
import { AssetCategory } from '@prisma/client';

export class CreateAssetPurchaseDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(AssetCategory)
  category: AssetCategory;

  @IsDateString()
  purchaseDate: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  purchasePrice: number;

  // Either a regular money account (cash/bank/mfs) or a Savings Wallet --
  // see AssetsService.requirePaymentAccount().
  @IsString()
  @IsNotEmpty()
  purchaseAccountId: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
