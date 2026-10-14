import { IsNotEmpty, IsOptional, IsString, Matches, ValidateIf } from 'class-validator';
import { whenSent } from '../../common/dto.js';

// Phone, email and pin may be sent as null to clear them; name and currency
// can't be cleared, so an explicit null is validated (and refused).
export class UpdateBusinessDto {
  @ValidateIf(whenSent)
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ValidateIf(whenSent)
  @IsString()
  @IsNotEmpty()
  currency?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4,6}$/, { message: 'PIN must be 4 to 6 digits' })
  pin?: string | null;
}
