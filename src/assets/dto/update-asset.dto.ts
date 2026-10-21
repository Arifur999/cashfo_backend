import { Transform } from 'class-transformer';
import { IsDateString, IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';
import { trim, whenSent } from '../../common/dto.js';

// Corrects an asset's details. Name and type can't be cleared, so an
// explicit null is validated (and refused); notes may be sent as null to
// clear them. The purchase date only changes on an asset recorded without
// paying from a wallet: a paid purchase keeps the date its posting has.
export class UpdateAssetDto {
  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  category?: string;

  @ValidateIf(whenSent)
  @IsDateString()
  purchaseDate?: string;

  @IsOptional()
  @IsString()
  notes?: string | null;
}
