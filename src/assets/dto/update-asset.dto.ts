import { Transform } from 'class-transformer';
import { IsDateString, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { IsMoney, trim, whenSent } from '../../common/dto.js';

// Corrects an asset's details (All Assets › Edit asset, Purchase & Sell ›
// Edit purchase). Name and type can't be cleared, so an explicit null is
// validated (and refused); notes may be sent as null to clear them.
// purchaseAccountId: a wallet the purchase was paid from, or null for an
// asset already owned (no money moved). A change to the price, the date or
// how it was paid voids the old purchase posting and posts the new one.
export class UpdateAssetDto {
  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name?: string;

  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  category?: string;

  @ValidateIf(whenSent)
  @IsDateString()
  purchaseDate?: string;

  @ValidateIf(whenSent)
  @IsMoney()
  purchasePrice?: number;

  @ValidateIf((_: unknown, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @IsNotEmpty()
  purchaseAccountId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string | null;
}
