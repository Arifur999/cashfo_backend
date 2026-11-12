import { Transform } from 'class-transformer';
import { IsDateString, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { IsMoney, trim } from '../../common/dto.js';

export class CreateAssetPurchaseDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  category: string;

  @IsDateString()
  purchaseDate: string;

  @IsMoney()
  purchasePrice: number;

  // Either a regular money account (cash/bank/mfs) or a Savings Wallet --
  // see AssetsService.requirePaymentAccount(). Omitted for an asset already
  // owned: it is recorded at its value without any money moving -- see
  // AssetsService.purchase()'s comment.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  purchaseAccountId?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  notes?: string;
}
