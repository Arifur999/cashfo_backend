import { IsBoolean, IsNotEmpty, IsString, MinLength, ValidateIf } from 'class-validator';
import { whenSent } from '../../common/dto.js';

export class SuspendOwnerDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  reason: string;

  // "Also sign out of every device now"; on unless sent as false.
  @ValidateIf(whenSent)
  @IsBoolean()
  signOutEverywhere?: boolean;
}
