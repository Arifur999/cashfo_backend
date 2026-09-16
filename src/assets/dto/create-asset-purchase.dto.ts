import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class CreateAssetPurchaseDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  category: string;

  @IsDateString()
  purchaseDate: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  purchasePrice: number;

  // Either a regular money account (cash/bank/mfs) or a Savings Wallet --
  // see AssetsService.requirePaymentAccount(). Omitted entirely by "Current
  // Asset list"'s simpler Add Assets flow, which just records an asset
  // without tracking which account paid for it -- see
  // AssetsService.purchase()'s comment.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  purchaseAccountId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
